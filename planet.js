import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';

const planetVertexShader = /* glsl */ `
    uniform float uRadius;

    varying float vHeight;  // displacement from the base sphere surface
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
        vHeight = length(position) - uRadius;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
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
    varying vec3 vViewPosition;

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

        // point lights (the sun); no distance falloff
        #if NUM_POINT_LIGHTS > 0
            for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
                vec3 lightDir = normalize(pointLights[i].position - vViewPosition);
                float diffuse = max(dot(normal, lightDir), 0.0);
                light += pointLights[i].color * diffuse;
            }
        #endif

        gl_FragColor = vec4(baseColor * light, 1.0);

        // convert linear -> sRGB output, like the built-in materials do
        #include <colorspace_fragment>
    }
`;



// small seedable PRNG so the same seed always gives the same planet
export function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}




export class Planet {

    constructor(palettes, profile) {
        this.rng = mulberry32(profile["id"]);
        this.palette = this.generatePalette();
        this.terrainParams = this.generateTerrainParams();

        console.log(this.rng())
        this.noise = createNoise3D(this.rng);
    }

    generatePalette() {
        let palette = [];
        for (let i = 0; i < 7; i++) {
            palette.push({
                color: new THREE.Color(
                    this.rng(),
                    this.rng(),
                    this.rng()
                ),
                pos: this.rng()
            })
        }
        palette.sort((a, b) => a.pos - b.pos);
        return palette;
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
                    uColors: { value: terrainColors.map((c) => c.color) },
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
}

// color stops along the normalized height range (0 = lowest, 1 = highest).
// keep them sorted by pos; heights between two stops blend between their colors
export const palettes = [
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
