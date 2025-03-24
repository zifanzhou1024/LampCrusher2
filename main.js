import { GpuDevice, GpuMesh, gl } from "./gpu.js"
import { kShaders } from "./shaders.js"
import { Actor, Scene, Camera, Material, Renderer, DirectionalLight, SpotLight, kGroundMesh, kCubeMesh, load_gltf_model } from './renderer.js'

import * as THREE from 'three';
import { Vector2, Vector3, Vector4, Matrix4 } from 'three';

import lampGLB from './assets/lamp.glb';
import letterAGLB from './assets/pixar_a.glb';

const renderer = new Renderer();

const scene = new Scene();
scene.camera = new Camera( Math.PI / 4.0 );
scene.camera.transform.setPosition(0, 3, 5);

/////////////////////////////

const moveSpeed = 0.1;
const mouseSensitivity = 0.005;
const zoomSpeed = 0.5;

const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false
};

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let yaw = 0;
let pitch = 0;

document.addEventListener("keydown", (event) => {
    switch (event.code) {
        case "KeyW": movement.forward = true; break;
        case "KeyS": movement.backward = true; break;
        case "KeyA": movement.left = true; break;
        case "KeyD": movement.right = true; break;
    }
});

document.addEventListener("keyup", (event) => {
    switch (event.code) {
        case "KeyW": movement.forward = false; break;
        case "KeyS": movement.backward = false; break;
        case "KeyA": movement.left = false; break;
        case "KeyD": movement.right = false; break;
    }
});

// Mouse controls
document.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
        isDragging = true;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
    }
});

document.addEventListener("mouseup", () => {
    isDragging = false;
});

document.addEventListener("mousemove", (event) => {
    if (!isDragging) return;

    const dx = (event.clientX - lastMouseX) * mouseSensitivity;
    const dy = (event.clientY - lastMouseY) * mouseSensitivity;

    yaw -= dx;
    pitch -= dy;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)); // Clamp pitch

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
});

// Scroll to zoom
document.addEventListener("wheel", (event) => {
    const forward = new THREE.Vector3(0, 0, -1).applyMatrix4(scene.camera.transform);
    forward.setY(0).normalize(); // Keep movement level
    scene.camera.transform.premultiply(new THREE.Matrix4().makeTranslation(forward.x * (event.deltaY > 0 ? -zoomSpeed : zoomSpeed), 0, forward.z * (event.deltaY > 0 ? -zoomSpeed : zoomSpeed)));
});

function updateCamera() {
    const camMatrix = scene.camera.transform;

    // Extract position
    const position = new THREE.Vector3();
    position.setFromMatrixPosition(camMatrix);

    // Create rotation matrices
    const yawMatrix = new THREE.Matrix4().makeRotationY(yaw);
    const pitchMatrix = new THREE.Matrix4().makeRotationX(pitch);

    // Combine yaw and pitch
    const rotationMatrix = new THREE.Matrix4().multiplyMatrices(yawMatrix, pitchMatrix);

    // Create movement vectors
    const forward = new THREE.Vector3(0, 0, -1).applyMatrix4(rotationMatrix);
    const right = new THREE.Vector3(1, 0, 0).applyMatrix4(rotationMatrix);

    // Apply movement
    if (movement.forward) position.addScaledVector(forward, moveSpeed);
    if (movement.backward) position.addScaledVector(forward, -moveSpeed);
    if (movement.left) position.addScaledVector(right, -moveSpeed);
    if (movement.right) position.addScaledVector(right, moveSpeed);

    // Reconstruct the camera matrix with new position & rotation
    camMatrix.identity();
    camMatrix.premultiply(rotationMatrix);
    camMatrix.setPosition(position);
}

// Call updateCamera() in your update loop

/////////////////////////////


const ground = new Actor(
  kGroundMesh,
  new Material(
    kShaders.PS_PBRMaterial,
    { 
      g_Diffuse: [ 0.403, 0.538, 1.768 ],
      g_Roughness: 1.0,
      g_Metallic: 0.1,
    } 
  )
);

const cube = new Actor(
  kCubeMesh,
  new Material(
    kShaders.PS_PBRMaterial,
    { 
      g_Diffuse: [ 1.0, 0.0, 0.0 ],
      g_Roughness: 0.5,
      g_Metallic: 0.1,
    } 
  )
);

async function load_scene()
{
  const letter_mat = new Material( kShaders.PS_PBRMaterial, { g_Diffuse: [ 0.0, 0.0, 0.0 ], g_Roughness: 0.1, g_Metallic: 0.5 } );
  const lamp_model = await load_gltf_model( lampGLB );
  const letter_a_model = await load_gltf_model( letterAGLB );

  const lamp      = new Actor(
    lamp_model,
    new Material(
      kShaders.PS_PBRMaterial,
      { 
        g_Diffuse: [ 1.0, 1.0, 1.0 ],
        g_Roughness: 0.1,
        g_Metallic: 0.5  
      } 
    )
  );
  const letter_a = new Actor( letter_a_model, letter_mat );
  lamp.transform.makeScale(3, 3, 3);
  scene.actors.push(lamp);
  scene.actors.push(letter_a);

  const spot_light_pos = ( new Vector4(0.0,  1.0,  0.5, 1.0) ).applyMatrix4( lamp.transform );
  const spot_light_dir = ( new Vector4(0.0, -0.5,  1.0, 0.0) ).applyMatrix4( lamp.transform );
  scene.spot_light = new SpotLight(
    new Vector3( spot_light_pos.x, spot_light_pos.y, spot_light_pos.z ),
    new Vector3( spot_light_dir.x, spot_light_dir.y, spot_light_dir.z ),
    new Vector3( 1, 1, 1 ),
    10.0,
    Math.PI / 9,
    Math.PI / 6,
  );
}

load_scene();

cube.transform.setPosition(0, 5, -5);

scene.actors.push( ground );
scene.actors.push( cube );
scene.directional_light = new DirectionalLight( new Vector3( -1, -1, -1 ), new Vector3( 1, 1, 1 ), 7 );

let last_time = 0.0;
const update = (time) => 
{
  // In milliseconds
  const dt = (time - last_time) / 1000.0;

  console.log( scene );
  renderer.submit( scene );

  requestAnimationFrame(update);
  updateCamera();
};

requestAnimationFrame(update)
/*
import * as THREE from 'three';

const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 1000.0 );
const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
const cube     = new THREE.Mesh( geometry, material );
scene.add( cube );

camera.position.z = 5;

renderer.setAnimationLoop(
  () =>
  {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render( scene, camera );
  }
);
*/
