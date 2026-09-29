import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';

let w = window.innerWidth;
let h = window.innerHeight;

const renderer = new THREE.WebGLRenderer( { antialias: true } );
const camera = new THREE.PerspectiveCamera( 70, w / h, 0.01, 1000 );
const controls = new OrbitControls(camera, renderer.domElement);
controls.target = new THREE.Vector3(0, 0, 0);
// controls.autoRotate = true;

camera.position.set(0, 0, 2);
camera.rotation.set(-0.8, 0, 0);

const scene = new THREE.Scene();


const planetVertexShader = /* glsl */ `
    uniform float uRadius;

    varying float vHeight;  // displacement from the base sphere surface
    varying vec3 vNormal;

    void main() {
        vHeight = length(position) - uRadius;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const planetFragmentShader = /* glsl */ `
    #include <common>
    #include <lights_pars_begin>

    uniform float uBaseAmp;
    uniform vec3 uColors[NUM_COLORS];
    uniform float uStops[NUM_COLORS];

    varying float vHeight;
    varying vec3 vNormal;

    void main() {
        float height = clamp(0.5 * (vHeight / max(uBaseAmp, 1e-5)) + 0.5, 0.0, 1.0);

        // walk up the stops: t is 1 once we're past stop i, 0 before stop i-1, and
        // ramps between them, so only the segment containing height actually blends.
        // below the first stop -> first color, above the last stop -> last color
        vec3 baseColor = uColors[0];
        for (int i = 1; i < NUM_COLORS; i++) {
            float t = clamp((height - uStops[i - 1]) / max(uStops[i] - uStops[i - 1], 1e-5), 0.0, 1.0);
            baseColor = mix(baseColor, uColors[i], t);
        }

        // interpolation across the triangle denormalizes the normal
        vec3 normal = normalize(vNormal);

        vec3 light = ambientLightColor;

        // lambertian diffuse; directions are in view space, same as vNormal
        #if NUM_DIR_LIGHTS > 0
            for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
                float diffuse = max(dot(normal, directionalLights[i].direction), 0.0);
                light += directionalLights[i].color * diffuse;
            }
        #endif

        gl_FragColor = vec4(baseColor * light, 1.0);

        // convert linear -> sRGB output, like the built-in materials do
        #include <colorspace_fragment>
    }
`;



// small seedable PRNG so the same seed always gives the same planet
function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}




class Planet {

    constructor(palettes, profile) {
        this.rng = mulberry32(profile["id"]);
        this.palette = palettes[Math.floor(this.rng() * palettes.length)];
        this.terrainParams = this.generateTerrainParams();

        console.log(this.rng())
        this.noise = createNoise3D(this.rng);
    }

    generateTerrainParams() {
        return {
            numOctaves: 1 + Math.floor(this.rng() * 6),
            baseAmp: this.rng() / 3,
            baseFreq: 0.1 + this.rng() * 5,
            lacunarity: 1.5 + this.rng(),   // freq multiplier per octave
            persistence: this.rng(),  // amp multiplier per octave
        };
    }

    generatePlanet() {
        const sunGeo = new THREE.IcosahedronGeometry(15, 8);
        const sunMat = new THREE.MeshBasicMaterial({color: 0xffff00, wireframe: true});
        // const sunMesh = new THREE.Mesh(sunGeo, sunMat);

        const planetRadius = 0.5;

        // the active palette; the GUI edits it in place, so tweaks stick around if you
        // switch away and back (until reload)
        let terrainColors = this.palette;

        // IcosahedronGeometry is non-indexed (every triangle has its own vertices), so
        // computeVertexNormals() would just give face normals = flat shading. Merge
        // duplicate vertices so neighbouring triangles share them and normals get averaged.
        // uv/normal are dropped first, otherwise the uv seam would stop vertices merging there.
        let planetGeo = new THREE.IcosahedronGeometry(planetRadius, 64);
        planetGeo.deleteAttribute('uv');
        planetGeo.deleteAttribute('normal');
        planetGeo = mergeVertices(planetGeo);
        planetGeo.computeVertexNormals();

        const planetMat = new THREE.ShaderMaterial({
            // GLSL arrays need a compile-time size
            defines: { NUM_COLORS: terrainColors.length },
            // note: merge() clones these, so update via planetMat.uniforms, not the objects here
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.lights,
                {
                    uRadius: { value: planetRadius },
                    uBaseAmp: { value: this.terrainParams.baseAmp },
                    uColors: { value: terrainColors.map((c) => new THREE.Color(c.color)) },
                    uStops: { value: terrainColors.map((c) => c.pos) },
                }
            ]),
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
            lights: true
        });
        const planetWireMat = new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, wireframe: true})
        const planetMesh = new THREE.Mesh(planetGeo, planetMat);
        const planetWireMesh = new THREE.Mesh(planetGeo, planetWireMat);
        planetWireMesh.scale.set(1.001, 1.001, 1.001);
        planetWireMesh.visible = false;
        const planetGroup = new THREE.Group();
        planetGroup.add(planetMesh);
        planetGroup.add(planetWireMesh);

        this.planetMat = planetMat;
        this.planetMesh = planetMesh;
        this.planetWireMesh = planetWireMesh;

        this.generateTerrain();

        return planetGroup;

    }

    generateTerrain() {
        const positionAttribute = this.planetMesh.geometry.getAttribute("position");
        // keep the undisplaced sphere around so we can regenerate terrain from scratch
        const basePositions = positionAttribute.array.slice();

        const { numOctaves, baseAmp, baseFreq, lacunarity, persistence } = this.terrainParams;

        let vertex = new THREE.Vector3();

        for (let i = 0; i < positionAttribute.count; i++) {
            vertex.fromArray(basePositions, i * 3);

            let offset = 0
            let amp = baseAmp;
            let freq = baseFreq;
            for (let j = 0; j < numOctaves; j++) {
                offset += amp * this.noise(freq * vertex.x, freq * vertex.y, freq * vertex.z)
                freq *= lacunarity
                amp *= persistence
            }

            const dir = vertex.clone().normalize();

            vertex.x += dir.x * offset
            vertex.y += dir.y * offset
            vertex.z += dir.z * offset

            positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }

        // keep the shader's height normalization in sync with the slider
        this.planetMat.uniforms.uBaseAmp.value = baseAmp;

        positionAttribute.needsUpdate = true;
        this.planetMesh.geometry.computeVertexNormals();
        this.planetMesh.geometry.computeBoundingBox();
        this.planetMesh.geometry.computeBoundingSphere();
    }
};

// color stops along the normalized height range (0 = lowest, 1 = highest).
// keep them sorted by pos; heights between two stops blend between their colors
const palettes = [
    [
        { name: 'deep water',    color: '#1a3a6b', pos: 0.39 },
        { name: 'shallow water', color: '#2f6fb0', pos: 0.45 },
        { name: 'sand',          color: '#e0d38a', pos: 0.53 },
        { name: 'grass',         color: '#4a8f3a', pos: 0.61 },
        { name: 'forest',        color: '#11461e', pos: 0.7 },
        { name: 'rock',          color: '#76736f', pos: 0.85 },
        { name: 'snow',          color: '#b5b5b5', pos: 0.98 },
    ],
    [
        { name: 'deep water',    color: '#ba772c', pos: 0.0 },
        { name: 'shallow water', color: '#a48f41', pos: 0.35 },
        { name: 'sand',          color: '#ca974e', pos: 0.42 },
        { name: 'grass',         color: '#ba8b26', pos: 0.47 },
        { name: 'forest',        color: '#88540c', pos: 0.6 },
        { name: 'rock',          color: '#634221', pos: 0.75 },
        { name: 'snow',          color: '#443217', pos: 0.9 },
    ],
    [
        { name: 'deep water',    color: '#969da6', pos: 0.0 },
        { name: 'shallow water', color: '#6f8295', pos: 0.35 },
        { name: 'sand',          color: '#9fa4bc', pos: 0.42 },
        { name: 'grass',         color: '#616a8f', pos: 0.47 },
        { name: 'forest',        color: '#344965', pos: 0.6 },
        { name: 'rock',          color: '#7f7f90', pos: 0.75 },
        { name: 'snow',          color: '#b7b8bd', pos: 0.9 },
    ],
];


const res = await fetch('/server/data/profiles.json');
const profiles = await res.json();

let planetGroup = null;

function showProfile(id) {
    if (planetGroup) {
        scene.remove(planetGroup);
        // both meshes share the geometry; dispose it and each material once
        planetGroup.children[0].geometry.dispose();
        planetGroup.children.forEach((mesh) => mesh.material.dispose());
    }
    const profile = profiles.find((p) => p.id === id);
    planetGroup = new Planet(palettes, profile).generatePlanet();
    scene.add(planetGroup);
}

// lil-gui dropdowns take a { label: value } map
const profileOptions = Object.fromEntries(
    profiles.map((p) => [`${p.name} (${p.id})`, p.id])
);
const profileParams = { id: profiles[6].id };

const gui = new GUI({ title: 'Profile' });
gui.add(profileParams, 'id', profileOptions).name('person').onChange(showProfile);

showProfile(profileParams.id);

// generateTerrain();

// const gui = new GUI({ title: 'Terrain' });
// gui.add(planet.terrainParams, 'seed', 0, 1000, 1).onChange((seed) => {
//     noise = createNoise3D(mulberry32(seed));
//     planet.generateTerrain();
// });
// gui.add(planet.terrainParams, 'numOctaves', 1, 10, 1).onChange(planet.generateTerrain);
// gui.add(planet.terrainParams, 'baseAmp', 0, 0.5, 0.001).onChange(planet.generateTerrain);
// gui.add(planet.terrainParams, 'baseFreq', 0.1, 10, 0.01).onChange(planet.generateTerrain);
// gui.add(planet.terrainParams, 'lacunarity', 1, 4, 0.01).onChange(planet.generateTerrain);
// gui.add(planet.terrainParams, 'persistence', 0, 1, 0.01).onChange(planet.generateTerrain);
// gui.add(planet.planetWireMesh, 'visible').name('wireframe');

// const colorFolder = gui.addFolder('Colors');
// colorFolder.add(paletteParams, 'palette', Object.keys(palettes)).onChange((name) => {
//     applyPalette(palettes[name]);
// });

// // lil-gui turns function properties into buttons
// colorFolder.add({
//     savePalette() {
//         // JSON so it can be pasted straight into palettes
//         console.log(JSON.stringify(terrainColors, null, 4));
//     },
// }, 'savePalette').name('save palette');

// let stopControllers = [];

// // one color picker + pos slider per stop; rebuilt whenever the palette changes
// function buildStopControllers() {
//     stopControllers.forEach((c) => c.destroy());
//     stopControllers = [];

//     terrainColors.forEach((stop, i) => {
//         stopControllers.push(
//             colorFolder.addColor(stop, 'color').name(stop.name).onChange((hex) => {
//                 planetMat.uniforms.uColors.value[i].set(hex);
//             }),
//             colorFolder.add(stop, 'pos', 0, 1, 0.01).name(`${stop.name} pos`).onChange((pos) => {
//                 planetMat.uniforms.uStops.value[i] = pos;
//             }),
//         );
//     });
// }

// function applyPalette(palette) {
//     terrainColors = palette;
//     planetMat.uniforms.uColors.value = palette.map((c) => new THREE.Color(c.color));
//     planetMat.uniforms.uStops.value = palette.map((c) => c.pos);

//     // NUM_COLORS is baked into the shader, so a different-length palette needs a recompile
//     if (planetMat.defines.NUM_COLORS !== palette.length) {
//         planetMat.defines.NUM_COLORS = palette.length;
//         planetMat.needsUpdate = true;
//     }

//     buildStopControllers();
// }

// buildStopControllers();

// const ringGeo = new THREE.RingGeometry(99, 101, 100, 1);
// const ringMat = new THREE.MeshBasicMaterial({color: 0xffffff});
// const ringMesh = new THREE.Mesh(ringGeo, ringMat);
// ringMesh.rotation.set(Math.PI / 2, 0, 0);

const ambientLight = new THREE.AmbientLight( 0x404040, 5 );

// shines toward its target (the origin by default)
const dirLight = new THREE.DirectionalLight( 0xffffff, 2 );
dirLight.position.set(5, 3, 5);

// scene.add(sunMesh);
scene.add(ambientLight);
scene.add(dirLight);
// scene.add(ringMesh);


renderer.setSize(w, h);
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );

window.addEventListener("resize", () => {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
});

function animate( time ) {
    //console.log(time);

    const newX = Math.sin(2 * Math.PI * time/4000) * 100;
    const newZ = Math.cos(2 * Math.PI * time/4000) * 100;

    // planetMesh.position.set(newX, 0, newZ)


    // mesh.rotation.x = time / 2000;
    // mesh.rotation.y = time / 1000;

    // camera.position.z = time / 1000;
    // boardMesh.rotation.y = time/1000;

    controls.update();
    renderer.render( scene, camera );
}

