import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/Addons.js';

let w = window.innerWidth;
let h = window.innerHeight;

const renderer = new THREE.WebGLRenderer( { antialias: true } );
const camera = new THREE.PerspectiveCamera( 70, w / h, 0.01, 1000 );
const controls = new OrbitControls(camera, renderer.domElement);
controls.target = new THREE.Vector3(0, 0, 0);
// controls.autoRotate = true;

camera.position.set(0, 200, 150);
camera.rotation.set(-0.8, 0, 0);

const scene = new THREE.Scene();

const sunGeo = new THREE.SphereGeometry(15, 32, 16);
const sunMat = new THREE.MeshBasicMaterial({color: 0xffff00});
const sunMesh = new THREE.Mesh(sunGeo, sunMat);

const planetGeo = new THREE.SphereGeometry(8, 16, 8);
const planetMat = new THREE.MeshBasicMaterial({color: 0x00ff00});
const planetMesh = new THREE.Mesh(planetGeo, planetMat);
planetMesh.position.set(60, 0, 0);

const ringGeo = new THREE.RingGeometry(99, 101, 100, 1);
const ringMat = new THREE.MeshBasicMaterial({color: 0xffffff});
const ringMesh = new THREE.Mesh(ringGeo, ringMat);
ringMesh.rotation.set(Math.PI / 2, 0, 0);

const ambientLight = new THREE.AmbientLight( 0x404040, 5 );

scene.add(sunMesh);
scene.add(planetMesh);
scene.add(ambientLight);
scene.add(ringMesh);


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

    planetMesh.position.set(newX, 0, newZ)


    // mesh.rotation.x = time / 2000;
    // mesh.rotation.y = time / 1000;

    // camera.position.z = time / 1000;
    // boardMesh.rotation.y = time/1000;

    controls.update();
    renderer.render( scene, camera );
}

