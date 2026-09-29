import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Planet, palettes } from './planet.js';

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


// const BATCHES = ['Summer 2, 2026', 'Fall 1, 2026', 'Fall 2, 2026'];
const BATCHES = ['Fall 2, 2026'];

const res = await fetch('/server/data/profiles.json');
const profiles = (await res.json()).filter((p) =>
    p.stints.some((s) => BATCHES.includes(s.batch?.name))
);

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

const sunGeo = new THREE.IcosahedronGeometry(15, 8);
const sunMat = new THREE.MeshBasicMaterial({color: 0xffff00, wireframe: true});
const sunMesh = new THREE.Mesh(sunGeo, sunMat);


scene.add(sunMesh);
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

