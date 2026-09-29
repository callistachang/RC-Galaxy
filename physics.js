import * as THREE from 'three';

// units: distance = scene units, time = seconds of sim time, G = 1.
// only G * mass / distance^3 matters (it sets the orbital periods), so masses are picked for looks
export const G = 1;
export const SUN_MASS = 10;

// ranges each seeded orbit is drawn from; angles in radians
export const ORBIT_RANGES = {
    semiMajorAxis: [4, 30],
    eccentricity: [0, 0.3],
    inclination: [0, THREE.MathUtils.degToRad(10)],
    mass: [0.001, 0.01],        // planet mass, same units as SUN_MASS
    spinPeriod: [5, 30],        // sim seconds per rotation about its own axis
    axialTilt: [0, THREE.MathUtils.degToRad(30)],
};

const TAU = 2 * Math.PI;

const between = (rng, [min, max]) => min + rng() * (max - min);

// draws every random physics param from rng, so the same seed always gives the same orbit
export function randomOrbitParams(rng, ranges = ORBIT_RANGES) {
    return {
        mass: between(rng, ranges.mass),
        spinPeriod: between(rng, ranges.spinPeriod),
        axialTilt: between(rng, ranges.axialTilt),
        elements: {
            semiMajorAxis: between(rng, ranges.semiMajorAxis),
            eccentricity: between(rng, ranges.eccentricity),
            inclination: between(rng, ranges.inclination),
            longitudeOfAscendingNode: rng() * TAU,
            argumentOfPeriapsis: rng() * TAU,
            meanAnomaly: rng() * TAU,   // where along the orbit the planet starts
        },
    };
}

// Kepler's equation M = E - e sin E, solved for the eccentric anomaly E with Newton's method
function solveKepler(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 20; i++) {
        const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        E -= dE;
        if (Math.abs(dE) < 1e-12) break;
    }
    return E;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// orbital elements are defined z-up; three.js is y-up, so finish with a -90° turn about x
function orbitalPlaneRotation({ inclination, longitudeOfAscendingNode, argumentOfPeriapsis }) {
    const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2);
    return q
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, longitudeOfAscendingNode))
        .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, inclination))
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, argumentOfPeriapsis));
}

// Keplerian elements -> position and velocity relative to the central body
export function elementsToState(elements, mu) {
    const { semiMajorAxis: a, eccentricity: e, meanAnomaly } = elements;
    const E = solveKepler(meanAnomaly, e);
    const b = a * Math.sqrt(1 - e * e);

    // in the orbital plane with periapsis along +x
    const meanMotion = Math.sqrt(mu / (a * a * a));
    const dEdt = meanMotion / (1 - e * Math.cos(E));
    const position = new THREE.Vector3(a * (Math.cos(E) - e), b * Math.sin(E), 0);
    const velocity = new THREE.Vector3(-a * Math.sin(E) * dEdt, b * Math.cos(E) * dEdt, 0);

    const q = orbitalPlaneRotation(elements);
    return { position: position.applyQuaternion(q), velocity: velocity.applyQuaternion(q) };
}

// points along the ideal ellipse, e.g. for drawing the orbit as a line
export function orbitPath(elements, mu, segments = 256) {
    const points = [];
    for (let i = 0; i < segments; i++) {
        const meanAnomaly = (i / segments) * TAU;
        points.push(elementsToState({ ...elements, meanAnomaly }, mu).position);
    }
    return points;
}

// Newtonian gravity toward the origin: a = -mu r / |r|^3
function gravity(position, mu, out) {
    const r = position.length();
    return out.copy(position).multiplyScalar(-mu / (r * r * r));
}

// a body orbiting a central body at the origin.
// the 2-body problem reduces exactly to the relative position obeying a = -mu r / |r|^3
// with mu = G(M + m), so the central body stays put and we integrate the relative motion
export class OrbitingBody {
    constructor({ mass, elements, spinPeriod, axialTilt }, centralMass = SUN_MASS) {
        this.mass = mass;
        this.mu = G * (centralMass + mass);
        this.elements = elements;

        const { position, velocity } = elementsToState(elements, this.mu);
        this.position = position;
        this.velocity = velocity;
        this.acceleration = gravity(position, this.mu, new THREE.Vector3());

        this.spinRate = TAU / spinPeriod;
        this.axialTilt = axialTilt;
        this.spinAngle = 0;
    }

    get period() {
        return TAU * Math.sqrt(this.elements.semiMajorAxis ** 3 / this.mu);
    }

    // specific orbital energy; should stay ~constant, handy for checking integrator drift
    get energy() {
        return 0.5 * this.velocity.lengthSq() - this.mu / this.position.length();
    }

    // velocity Verlet: symplectic, so energy stays bounded and orbits don't slowly spiral
    step(dt) {
        this.velocity.addScaledVector(this.acceleration, dt / 2);
        this.position.addScaledVector(this.velocity, dt);
        gravity(this.position, this.mu, this.acceleration);
        this.velocity.addScaledVector(this.acceleration, dt / 2);

        this.spinAngle = (this.spinAngle + this.spinRate * dt) % TAU;
    }
}

// steps all bodies with a fixed dt so the result doesn't depend on frame rate
export class PhysicsWorld {
    constructor({ fixedDt = 1 / 120, maxSubsteps = 240 } = {}) {
        this.bodies = [];
        this.fixedDt = fixedDt;
        this.maxSubsteps = maxSubsteps;
        this.timeScale = 1;
        this.paused = false;
        this.accumulator = 0;
    }

    add(body) {
        this.bodies.push(body);
        return body;
    }

    // frameDt is real seconds since the last frame
    update(frameDt) {
        if (this.paused) return;
        this.accumulator += frameDt * this.timeScale;

        let steps = 0;
        while (this.accumulator >= this.fixedDt && steps < this.maxSubsteps) {
            this.bodies.forEach((body) => body.step(this.fixedDt));
            this.accumulator -= this.fixedDt;
            steps++;
        }
        // too far behind (huge timeScale, slow machine): drop the backlog rather than spiral
        if (steps === this.maxSubsteps) this.accumulator = 0;
    }
}
