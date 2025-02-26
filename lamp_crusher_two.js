import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// ----- Scene, Camera, Renderer Setup -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 1000
);
camera.position.set(0, 5, 15);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

// Request pointer lock on click to enable mouse control
renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
});

// ----- Ground -----
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x808080 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// ----- Lights -----
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const lampLight = new THREE.PointLight(0xffaa00, 1, 100);
lampLight.position.set(0, 2, 0);
scene.add(lampLight);

// ----- Global Variables for Lamp Control -----
let lamp = null; // will store the lamp object once loaded
const keyStates = {};
let firstPersonView = false;  // default to third-person view
let vKeyPressed = false;      // flag to prevent continuous toggling

// Arrays to keep track of letters for collision/squish animation
const staticLetters = [];
const fallingLetters = [];


// Mouse-controlled camera rotation angles (in radians)
let cameraRotationX = 0;
let cameraRotationY = 0;

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    keyStates[key] = true;
    if (key === 'v' && !vKeyPressed) {
        firstPersonView = !firstPersonView;
        vKeyPressed = true;
        console.log("View mode toggled. First-person:", firstPersonView);
    }
});
window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    keyStates[key] = false;
    if (key === 'v') {
        vKeyPressed = false;
    }
});

// Mouse movement (when pointer is locked)
window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === renderer.domElement) {
        const sensitivity = 0.002;
        cameraRotationX += event.movementY * sensitivity;
        cameraRotationY -= event.movementX * sensitivity;
        // Clamp vertical rotation to avoid flipping
        cameraRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraRotationX));
    }
});

// Variables for jump physics
let lampJumpVelocity = 0;
let lampIsJumping = false;
const gravity = -9.8;    // gravity acceleration (adjust as needed)
const jumpStrength = 5;  // initial upward velocity for jump
let lampInitialY = 0;    // record starting Y position

// THREE.Clock for delta time
const clock = new THREE.Clock();

// ----- Load the Lamp Model (OBJ + MTL) -----
// NOTE: Lamp is now scaled 3× instead of 2×.
const mtlLoaderLamp = new MTLLoader();
mtlLoaderLamp.setPath('assets/');
mtlLoaderLamp.load('lamp.mtl', (materials) => {
    materials.preload();
    const objLoaderLamp = new OBJLoader();
    objLoaderLamp.setMaterials(materials);
    objLoaderLamp.setPath('assets/');
    objLoaderLamp.load('lamp.obj',
        (object) => {
            // Position such that the base is on the ground
            object.position.set(0, 0, 0);
            // Scale the lamp 3x larger now
            object.scale.set(3, 3, 3);
            scene.add(object);
            lamp = object;
        },
        (xhr) => {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded for lamp');
        },
        (error) => {
            console.error('An error occurred while loading the lamp:', error);
        }
    );
});

// ----- Helper Function to Load Static Letters -----
function loadLetter(letter, posX, posY, posZ) {
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath('assets/');
    mtlLoader.load(`pixar_${letter}.mtl`, (materials) => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath('assets/');
        objLoader.load(`pixar_${letter}.obj`,
            (object) => {
                // Rotate the letter 90° to the left about Y so its front faces forward
                object.rotation.y = -Math.PI / 2;
                // Place the letter so its base is on the ground
                object.position.set(posX, posY, posZ);
                scene.add(object);
                // Save for collision detection and squish animation
                staticLetters.push(object);
            },
            (xhr) => {
                console.log(`Letter ${letter}: ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                console.error(`An error occurred while loading letter ${letter}:`, error);
            }
        );
    });
}

// ----- Load Static Letters (remain on the ground) -----
loadLetter('p', -4, 0, 0);
loadLetter('i', -2, 0, 0);
loadLetter('x',  0, 0, 0);
loadLetter('a',  2, 0, 0);
loadLetter('r',  4, 0, 0);

// ----- Dynamic Spawning of Falling Letters -----
const letterGravity = -4.9; // gravity constant for falling letters

function loadFallingLetter(letter, posX, posY, posZ) {
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath('assets/');
    mtlLoader.load(`pixar_${letter}.mtl`, (materials) => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath('assets/');
        objLoader.load(`pixar_${letter}.obj`,
            (object) => {
                // Rotate the letter 90° to the left so its front faces forward
                object.rotation.y = -Math.PI / 2;
                // Set the starting position for the falling letter
                object.position.set(posX, posY, posZ);
                // Initialize its downward velocity (stored in userData)
                object.userData.velocityY = 0;
                // For squish animation: flag and timer
                object.userData.squishing = false;
                scene.add(object);
                fallingLetters.push(object);
            },
            (xhr) => {
                console.log(`Falling letter ${letter}: ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                console.error(`Error loading falling letter ${letter}:`, error);
            }
        );
    });
}

function spawnFallingLetter() {
    const letters = ['p', 'i', 'x', 'a', 'r'];
    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
    // Randomize x and z positions within a chosen range (e.g., [-10, 10])
    const posX = Math.random() * 20 - 10;
    const posY = 20; // Spawn high above the ground
    const posZ = Math.random() * 20 - 10;
    loadFallingLetter(randomLetter, posX, posY, posZ);
}

// Spawn a new falling letter every 2 seconds
setInterval(spawnFallingLetter, 2000);

// ----- Collision & Squish Animation Parameters -----
const collisionThreshold = 1;      // horizontal distance threshold for collision
const squishDuration = 1;          // duration (in seconds) for squish animation

// ----- Animation Loop -----
function animate() {
    const dt = clock.getDelta();

    if (lamp) {
        const speed = 0.1;

        // Compute the forward vector from the camera, ignoring the vertical component
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        // Compute the right vector (perpendicular to forward)
        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
        right.normalize();

        // Calculate movement vector based on key states
        let move = new THREE.Vector3();
        if (keyStates['w']) move.add(forward);
        if (keyStates['s']) move.sub(forward);
        if (keyStates['a']) move.sub(right);
        if (keyStates['d']) move.add(right);

        // If there is any movement, update lamp's position and rotation
        if (move.length() > 0) {
            move.normalize();
            lamp.position.add(move.multiplyScalar(speed));
            // Set lamp rotation so it faces the direction of movement
            lamp.rotation.y = Math.atan2(move.x, move.z);
        }

        // ----- Jump Movement -----
        if (keyStates[' '] && !lampIsJumping) {
            lampJumpVelocity = jumpStrength;
            lampIsJumping = true;
            lampInitialY = lamp.position.y;
        }
        if (lampIsJumping) {
            lampJumpVelocity += gravity * dt;
            lamp.position.y += lampJumpVelocity * dt;
            if (lamp.position.y < lampInitialY) {
                lamp.position.y = lampInitialY;
                lampIsJumping = false;
                lampJumpVelocity = 0;
            }
        }

        // Update the lamp's point light to follow (with offset)
        lampLight.position.set(lamp.position.x, lamp.position.y + 2, lamp.position.z);

        // ----- Camera Control -----
        if (firstPersonView) {
            const eyeOffset = new THREE.Vector3(0, 1, 0);
            camera.position.copy(lamp.position).add(eyeOffset);
            // Compute look direction from mouse angles for first-person view
            const lookDirection = new THREE.Vector3(
                Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                Math.sin(cameraRotationX),
                Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.lookAt(lamp.position.clone().add(lookDirection));
        } else {
            // Third-person view: camera orbits around the lamp based on mouse angles
            const distance = 15;
            const offset = new THREE.Vector3(
                distance * Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                distance * Math.sin(cameraRotationX) + 5,
                distance * Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.position.copy(lamp.position).add(offset);
            camera.lookAt(lamp.position);
        }
    }

    // ----- Update Falling Letters Movement -----
    for (let i = fallingLetters.length - 1; i >= 0; i--) {
        const letter = fallingLetters[i];
        // Update its vertical velocity with gravity
        letter.userData.velocityY += letterGravity * dt;
        // Move the letter downwards based on its velocity
        letter.position.y += letter.userData.velocityY * dt;
        // If the falling letter reaches the ground, clamp its y position (it will still be interactable)
        if (letter.position.y <= 0) {
            letter.position.y = 0;
        }
    }

    // ----- Collision Detection & Squish Animation for All Letters -----
    // Process both static and falling letters for collision with the lamp.
    [staticLetters, fallingLetters].forEach(letterArray => {
        for (let i = letterArray.length - 1; i >= 0; i--) {
            const letter = letterArray[i];
            // If the letter hasn't started squishing and the lamp is falling (jumping downward)
            if (!letter.userData.squishing && lampJumpVelocity < 0) {
                // Check horizontal distance (in XZ plane)
                const dx = lamp.position.x - letter.position.x;
                const dz = lamp.position.z - letter.position.z;
                const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
                // Also check that the lamp is coming from above the letter
                if (horizontalDistance < collisionThreshold && lamp.position.y > letter.position.y + 1) {
                    // Trigger squish animation on the letter
                    letter.userData.squishing = true;
                    letter.userData.squishElapsed = 0;
                    letter.userData.squishDuration = squishDuration;
                    letter.userData.originalScale = letter.scale.clone();
                }
            }
            // If the letter is in the process of squishing, update its animation
            if (letter.userData.squishing) {
                letter.userData.squishElapsed += dt;
                let progress = letter.userData.squishElapsed / letter.userData.squishDuration;
                if (progress > 1) progress = 1;
                // Gradually reduce the vertical scale (down to 10% of its original height)
                letter.scale.y = letter.userData.originalScale.y * (1 - 0.9 * progress);
                // Optionally, you could also adjust material opacity here if desired.
                // Once squish animation is complete, remove the letter.
                if (progress >= 1) {
                    scene.remove(letter);
                    letterArray.splice(i, 1);
                }
            }
        }
    });

    renderer.render(scene, camera);
}
