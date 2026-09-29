import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer, OrbitControls } from 'three/examples/jsm/Addons.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Planet, mulberry32, palettes } from './planet.js';
import { OrbitingBody, PhysicsWorld, SUN_MASS, orbitPath, randomOrbitParams } from './physics.js';

let w = window.innerWidth;
let h = window.innerHeight;

const renderer = new THREE.WebGLRenderer( { antialias: true } );
// draws the HTML name labels on top of the canvas
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';  // let OrbitControls get the mouse
const camera = new THREE.PerspectiveCamera( 70, w / h, 0.01, 1000 );
const controls = new OrbitControls(camera, renderer.domElement);
controls.target = new THREE.Vector3(0, 0, 0);

camera.position.set(0, 30, 45);

const scene = new THREE.Scene();

const BATCHES = ['Summer 2, 2026', 'Fall 1, 2026', 'Fall 2, 2026'];

const res = await fetch('/server/data/profiles.json');
const profiles = (await res.json()).filter((p) =>
    p.stints.some((s) => BATCHES.includes(s.batch?.name))
);

const sunMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffcc33 }),
);
scene.add(sunMesh);

const world = new PhysicsWorld();
// the seeded orbits take minutes of sim time, so speed things up by default
world.timeScale = 5;
const orbitLines = new THREE.Group();
scene.add(orbitLines);

// separate stream from the terrain rng, so tweaking terrain generation doesn't reshuffle orbits
const orbitSeed = (id) => id ^ 0x9e3779b9;

const planets = profiles.map((profile) => {
    const group = new Planet(palettes, profile).generatePlanet();
    const body = world.add(new OrbitingBody(randomOrbitParams(mulberry32(orbitSeed(profile.id))), SUN_MASS));

    const orbitLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(orbitPath(body.elements, body.mu)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
    );
    orbitLines.add(orbitLine);
    // added to the scene rather than the planet group so it doesn't spin with the planet
    const labelDiv = document.createElement('div');
    labelDiv.className = 'planet-label';
    labelDiv.textContent = profile.name;
    labelDiv.addEventListener('click', () => focusController.setValue(profile.id));
    const label = new CSS2DObject(labelDiv);

    scene.add(group, label);
    // someone can be in more than one of the batches, e.g. if they extended
    const batches = profile.stints.map((s) => s.batch?.name).filter((b) => BATCHES.includes(b));
    return { id: profile.id, profile, batches, group, body, label, orbitLine };
});

// copy physics state onto the meshes
function syncPlanets() {
    planets.forEach(({ group, body, label }) => {
        group.position.copy(body.position);
        label.position.set(0, 1.2, 0).add(body.position);  // just above the planet
        // spin about the planet's own y axis, then tilt that axis
        group.rotation.set(0, body.spinAngle, body.axialTilt, 'ZYX');
    });
}
syncPlanets();

// the camera follows whatever is focused; OrbitControls still lets you orbit around it
let focused = sunMesh;

// seconds for the camera to fly over to a newly focused body
const FLIGHT_DURATION = 1.2;
// in-progress camera move: lerps target and camera offset from where they were to the focused body
let flight = null;

function focusOn(id) {
    const planet = planets.find((p) => p.id === id);
    focused = planet ? planet.group : sunMesh;
    flight = {
        fromTarget: controls.target.clone(),
        fromOffset: camera.position.clone().sub(controls.target),
        toOffset: planet ? new THREE.Vector3(0, 1.5, 3) : new THREE.Vector3(0, 30, 45),
        t: 0,
    };
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// runs every frame: either continue the flight, or keep the camera locked onto the focused body
function updateCamera(dt) {
    if (flight) {
        flight.t = Math.min(flight.t + dt / FLIGHT_DURATION, 1);
        const k = easeInOutCubic(flight.t);
        // lerp towards the body's current position, so we land on it even though it's moving
        controls.target.lerpVectors(flight.fromTarget, focused.position, k);
        camera.position.lerpVectors(flight.fromOffset, flight.toOffset, k).add(controls.target);
        if (flight.t === 1) flight = null;
        return;
    }
    const delta = focused.position.clone().sub(controls.target);
    controls.target.add(delta);
    camera.position.add(delta);
}

// click a planet (or the sun) to focus it
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDownAt = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDownAt = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
    // ignore drags, those are OrbitControls rotating the view
    if (!pointerDownAt || Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y) > 5) return;

    pointer.set((e.clientX / w) * 2 - 1, -(e.clientY / h) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // the raycaster doesn't skip hidden objects, so only test planets in the selected batch
    const clickables = [sunMesh, ...planets.filter((p) => p.group.visible).map((p) => p.group)];
    const hit = raycaster.intersectObjects(clickables, true)[0];
    if (!hit) return;

    const planet = planets.find((p) => {
        for (let o = hit.object; o; o = o.parent) if (o === p.group) return true;
        return false;
    });
    focusController.setValue(planet ? planet.id : 'sun');
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') focusController.setValue('sun');
});

const gui = new GUI({ title: 'Galaxy' });

// lil-gui dropdowns take a { label: value } map
const batchOptions = { 'all batches': 'all', ...Object.fromEntries(BATCHES.map((b) => [b, b])) };
const batchParams = { batch: 'all' };
const batchController = gui.add(batchParams, 'batch', batchOptions).onChange(showBatch);

const focusParams = { id: 'sun' };
let focusController = null;

// lil-gui can't change a dropdown's options in place, so rebuild it with only the visible planets
function buildFocusController() {
    focusController?.destroy();
    const focusOptions = {
        'sun (overview)': 'sun',
        ...Object.fromEntries(planets
            .filter((p) => p.group.visible)
            .map(({ profile }) => [`${profile.name} (${profile.id})`, profile.id])),
    };
    focusController = gui.add(focusParams, 'id', focusOptions).name('focus').onChange(focusOn);
    // new controllers go at the bottom; keep it next to the batch dropdown
    batchController.domElement.after(focusController.domElement);
}
buildFocusController();

function showBatch(batch) {
    planets.forEach(({ batches, group, label, orbitLine }) => {
        const visible = batch === 'all' || batches.includes(batch);
        group.visible = label.visible = orbitLine.visible = visible;
    });
    // don't leave the camera stuck on a planet that just disappeared
    const focusedPlanet = planets.find((p) => p.id === focusParams.id);
    if (focusedPlanet && !focusedPlanet.group.visible) {
        focusParams.id = 'sun';
        focusOn('sun');
    }
    buildFocusController();
}

const physicsFolder = gui.addFolder('Physics');
physicsFolder.add(world, 'timeScale', 0, 20, 0.1).name('time scale');
physicsFolder.add(world, 'paused');
physicsFolder.add(orbitLines, 'visible').name('show orbits');
gui.add(labelRenderer.domElement.style, 'display', { shown: '', hidden: 'none' }).name('names');

const ambientLight = new THREE.AmbientLight( 0x404040, 5 );

// the sun; the planet shader ignores distance falloff, so every planet gets full light
const sunLight = new THREE.PointLight( 0xffffff, 2 );

scene.add(ambientLight);
scene.add(sunLight);

renderer.setSize(w, h);
labelRenderer.setSize(w, h);
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );
document.body.appendChild( labelRenderer.domElement );

window.addEventListener("resize", () => {
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
});

let lastTime = null;

function animate( time ) {
    // cap the step so a backgrounded tab doesn't come back to a huge jump
    const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    world.update(dt);
    syncPlanets();

    updateCamera(dt);

    controls.update();
    renderer.render( scene, camera );
    labelRenderer.render( scene, camera );
}
