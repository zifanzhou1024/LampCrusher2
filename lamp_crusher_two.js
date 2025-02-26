// lamp_crusher_two.js

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { initializeUI, updateUI, displayGameOverScreen, removeGameOverScreen } from './ui.js';

// ---------- Game State Variables --------------
let gameStarted = false;
let gameOver = false;
let health = 100;
let score = 0;
let startTime = 0;
let letterSpawnTimer = 0;          // accumulates time for spawning falling letters
let currentSpawnInterval = 2;      // initial spawn interval (in seconds)
let currentGameMode = 'normal';    // 'normal' or 'demo'
let healthDecreasePaused = false;  // New variable to pause health decrease

// Initialize UI elements.
const { startMenu } = initializeUI();

// ----- Global Variables for Lamp Control -----
let lamp = null; // the lamp object once loaded.
const keyStates = {};
let firstPersonView = false;  // default to third-person view.
let vKeyPressed = false;      // prevent continuous toggling.
let pKeyPressed = false;      // prevent continuous toggling for pause

const staticLetters = [];
const fallingLetters = [];

let cameraRotationX = 0;
let cameraRotationY = 0;
let cameraDistance = 15;

// ---------- Event Listeners ----------
window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    keyStates[key] = true;
    if (key === 'v' && !vKeyPressed) {
        firstPersonView = !firstPersonView;
        vKeyPressed = true;
        console.log("View mode toggled. First-person:", firstPersonView);
    }
    if (key === 'p' && !pKeyPressed) {
        healthDecreasePaused = !healthDecreasePaused;
        pKeyPressed = true;
        console.log("Health decrease paused:", healthDecreasePaused);
    }
});
window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    keyStates[key] = false;
    if (key === 'v') {
        vKeyPressed = false;
    }
    if (key === 'p') {
        pKeyPressed = false;
    }
});
window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === renderer.domElement) {
        const sensitivity = 0.002;
        cameraRotationX += event.movementY * sensitivity;
        cameraRotationY -= event.movementX * sensitivity;
        cameraRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraRotationX));
    }
});
window.addEventListener('wheel', (event) => {
    event.preventDefault();
    cameraDistance += event.deltaY * 0.01;
    cameraDistance = Math.max(5, Math.min(50, cameraDistance));
});

// Variables for jump physics.
let lampIsJumping = false;
const gravity = -9.8;
const jumpStrength = 6;
let lampInitialY = 0;

const clock = new THREE.Clock();

// ----- Three.js Scene Setup -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6689FF);  // Blue background

const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 1000
);
camera.position.set(0, 5, 15);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

// Request pointer lock on click.
renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
});

// ----- Ground -----
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x6689FF });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// ----- Lights -----
const ambientLight = new THREE.AmbientLight(0x6689FF, 0.5);
scene.add(ambientLight);

const lampLight = new THREE.SpotLight(0xffffff, 6, 100, Math.PI / 4, 0.1, 1);
lampLight.position.set(0, 0, 5);
lampLight.target.position.set(0, -1, 10);
scene.add(lampLight);
scene.add(lampLight.target);

// ----- Custom OBB Functions -----
function getOBB(object, collisionScale = 1) {
    object.updateWorldMatrix(true, false);
    let aabb = new THREE.Box3().setFromObject(object);
    let center = new THREE.Vector3();
    aabb.getCenter(center);
    let size = new THREE.Vector3();
    aabb.getSize(size);
    let halfSizes = size.multiplyScalar(0.5).multiplyScalar(collisionScale);
    let m = object.matrixWorld;
    let axes = [
        new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]).normalize(),
        new THREE.Vector3(m.elements[4], m.elements[5], m.elements[6]).normalize(),
        new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10]).normalize()
    ];
    return { center, axes, halfSizes };
}

function halfProjection(obb, axis) {
    return obb.halfSizes.x * Math.abs(axis.dot(obb.axes[0])) +
        obb.halfSizes.y * Math.abs(axis.dot(obb.axes[1])) +
        obb.halfSizes.z * Math.abs(axis.dot(obb.axes[2]));
}

function obbIntersect(obb1, obb2) {
    let axes = [];
    axes.push(obb1.axes[0], obb1.axes[1], obb1.axes[2],
        obb2.axes[0], obb2.axes[1], obb2.axes[2]);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let axis = new THREE.Vector3().crossVectors(obb1.axes[i], obb2.axes[j]);
            if (axis.lengthSq() > 1e-6) {
                axis.normalize();
                axes.push(axis);
            }
        }
    }
    let tVec = new THREE.Vector3().subVectors(obb2.center, obb1.center);
    for (let i = 0; i < axes.length; i++) {
        let axis = axes[i];
        let r1 = halfProjection(obb1, axis);
        let r2 = halfProjection(obb2, axis);
        let t = Math.abs(tVec.dot(axis));
        if (t > r1 + r2) {
            return false;
        }
    }
    return true;
}

// ----- Verlet Integration Helper Functions -----
// For falling letters (updates full position)
function verletIntegration(object, acceleration, dt) {
    if (!object.userData.previousPosition) {
        object.userData.previousPosition = object.position.clone();
    }
    const currentPos = object.position.clone();
    const newPos = currentPos.clone().multiplyScalar(2)
        .sub(object.userData.previousPosition)
        .add(acceleration.clone().multiplyScalar(dt * dt));
    object.userData.previousPosition.copy(currentPos);
    object.position.copy(newPos);
}

// For the lamp's vertical (y) motion only.
function verletVerticalIntegration(object, acceleration, dt) {
    if (object.userData.previousY === undefined) {
        object.userData.previousY = object.position.y;
    }
    let currentY = object.position.y;
    let newY = 2 * currentY - object.userData.previousY + acceleration * dt * dt;
    object.userData.previousY = currentY;
    object.position.y = newY;
}

// ----- Load the Lamp Model (OBJ + MTL) -----
const mtlLoaderLamp = new MTLLoader();
mtlLoaderLamp.setPath('assets/');
mtlLoaderLamp.load('lamp.mtl', (materials) => {
    materials.preload();
    const objLoaderLamp = new OBJLoader();
    objLoaderLamp.setMaterials(materials);
    objLoaderLamp.setPath('assets/');
    objLoaderLamp.load('lamp.obj',
        (object) => {
            object.position.set(0, 0, -10);
            object.scale.set(3, 3, 3);
            scene.add(object);
            lamp = object;
            // Initialize vertical integration state.
            lamp.userData.previousY = lamp.position.y;
            lampLight.position.set(0, 0.65, 0);
            lamp.add(lampLight);
            lampLight.target.position.set(0, -1, 10);
            lamp.add(lampLight.target);
        },
        (xhr) => {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded for lamp');
        },
        (error) => {
            console.error('Error loading lamp:', error);
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
                object.rotation.y = -Math.PI / 2;
                object.position.set(posX, posY, posZ);
                // Initialize previousPosition for Verlet integration.
                object.userData.previousPosition = object.position.clone();
                scene.add(object);
                staticLetters.push(object);
            },
            (xhr) => {
                console.log(`Letter ${letter}: ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
            },
            (error) => {
                console.error(`Error loading letter ${letter}:`, error);
            }
        );
    });
}

// Load Static Letters.
loadLetter('p', -4, 0, 0);
loadLetter('i', -2, 0, 0);
loadLetter('x',  0, 0, 0);
loadLetter('a',  2, 0, 0);
loadLetter('r',  4, 0, 0);

// ----- Dynamic Spawning of Falling Letters -----
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
                object.rotation.y = -Math.PI / 2;
                object.position.set(posX, posY, posZ);
                // Initialize previousPosition for Verlet integration.
                object.userData.previousPosition = object.position.clone();
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
    if (!gameStarted || gameOver) return;
    const letters = ['p', 'i', 'x', 'a', 'r'];
    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
    const posX = Math.random() * 20 - 10;
    const posY = 20;
    const posZ = Math.random() * 20 - 10;
    loadFallingLetter(randomLetter, posX, posY, posZ);
}

// ----- Collision & Squish Animation Parameters -----
const squishDuration = 0.5;
const lampCollisionScale = 0.8;
const letterCollisionScale = 0.9;

// ---------- Game Over and Reset Functions ----------
function displayGameOver() {
    gameOver = true;
    displayGameOverScreen(resetGame);
}

function startGame(mode = 'normal') {
    currentGameMode = mode;
    gameStarted = true;
    gameOver = false;
    health = mode === 'demo' ? 400 : 50;
    score = 0;
    startTime = performance.now();
    letterSpawnTimer = 0;
    currentSpawnInterval = 2;
    if (startMenu) {
        startMenu.style.display = 'none';
    }
}

function resetGame() {
    removeGameOverScreen();
    gameStarted = false;
    gameOver = false;
    health = currentGameMode === 'demo' ? 400 : 50;
    score = 0;
    startTime = 0;
    letterSpawnTimer = 0;
    currentSpawnInterval = 2;
    fallingLetters.forEach(letter => scene.remove(letter));
    fallingLetters.length = 0;
    if (lamp) {
        lamp.position.set(0, 0, -10);
        lamp.userData.previousY = lamp.position.y;
    }
    if (startMenu) {
        startMenu.style.display = 'block';
    }
}

// Expose startGame globally for UI access.
window.startGame = startGame;

// ----- Animation Loop -----
function animate() {
    const dt = clock.getDelta();

    if (gameStarted && !gameOver) {
        let elapsedTime = (performance.now() - startTime) / 1000;
        let healthDecreaseRate = 1 + Math.floor(elapsedTime / 10);
        if (!healthDecreasePaused) {
            // In demo mode, health decreases at half the rate.
            let decreaseAmount = 10 * healthDecreaseRate * dt;
            if (currentGameMode === 'demo') {
                decreaseAmount *= 0.5;
            }
            health -= decreaseAmount;
        }
        if (health <= 0) {
            health = 0;
            displayGameOver();
        }
        updateUI(health, score, elapsedTime);
        ambientLight.intensity = (health / 100) * 0.5;
        letterSpawnTimer += dt;
        if (letterSpawnTimer >= currentSpawnInterval) {
            spawnFallingLetter();
            letterSpawnTimer = 0;
            currentSpawnInterval = Math.max(0.5, 2 - elapsedTime * 0.1);
        }
    }

    if (lamp) {
        // --- Horizontal Movement (x,z) ---
        if (gameStarted) {
            const speed = 0.15;
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();
            const right = new THREE.Vector3();
            right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
            right.normalize();
            let move = new THREE.Vector3();
            if (keyStates['w']) move.add(forward);
            if (keyStates['s']) move.sub(forward);
            if (keyStates['a']) move.sub(right);
            if (keyStates['d']) move.add(right);
            if (move.length() > 0) {
                move.normalize();
                // Update only horizontal components.
                lamp.position.x += move.x * speed;
                lamp.position.z += move.z * speed;
            }
            // Trigger jump on input while moving.
            if (keyStates[' '] && !lampIsJumping) {
                lampIsJumping = true;
                lampInitialY = lamp.position.y;
                const dtApprox = 0.016;
                lamp.userData.previousY = lamp.position.y - jumpStrength * dtApprox;
            }
        }

        // --- Auto-Jump on Start Screen ---
        if (!gameStarted && !lampIsJumping) {
            lampIsJumping = true;
            lampInitialY = lamp.position.y;
            const dtApprox = 0.016;
            lamp.userData.previousY = lamp.position.y - jumpStrength * dtApprox;
        }

        // --- Vertical (Jump) Integration ---
        if (lampIsJumping) {
            verletVerticalIntegration(lamp, gravity, dt);
            if (lamp.position.y < lampInitialY) {
                lamp.position.y = lampInitialY;
                lampIsJumping = false;
                lamp.userData.previousY = lampInitialY;
            }
        }

        // --- Update Lamp Rotation Based on Mouse Movement ---
        // Offset by Math.PI to make the lamp face forward.
        lamp.rotation.y = cameraRotationY + Math.PI;

        // --- Camera Setup ---
        if (firstPersonView) {
            const eyeOffset = new THREE.Vector3(0, 1, 0);
            camera.position.copy(lamp.position).add(eyeOffset);
            const lookDirection = new THREE.Vector3(
                Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                Math.sin(cameraRotationX),
                Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.lookAt(lamp.position.clone().add(lookDirection));
        } else {
            const offset = new THREE.Vector3(
                cameraDistance * Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                cameraDistance * Math.sin(cameraRotationX) + 5,
                cameraDistance * Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.position.copy(lamp.position).add(offset);
            camera.lookAt(lamp.position);
        }

        // --- Lamp-Letter Collisions ---
        const lampOBB = getOBB(lamp, lampCollisionScale);
        const allLetters = staticLetters.concat(fallingLetters);
        for (let i = allLetters.length - 1; i >= 0; i--) {
            const letter = allLetters[i];
            const letterOBB = getOBB(letter, letterCollisionScale);
            if (obbIntersect(lampOBB, letterOBB)) {
                if (lamp.position.y > letter.position.y + 0.5) {
                    if (!letter.userData.squishing) {
                        letter.userData.squishing = true;
                        letter.userData.squishElapsed = 0;
                        letter.userData.squishDuration = squishDuration;
                        letter.userData.originalScale = letter.scale.clone();
                        score += 10;
                        health = Math.min(100, health + 10);
                    }
                } else {
                    let diff = new THREE.Vector3(lamp.position.x - letter.position.x, 0, lamp.position.z - letter.position.z);
                    if (diff.length() > 0.001) {
                        diff.normalize();
                        let attempts = 0;
                        while (obbIntersect(getOBB(lamp, lampCollisionScale), letterOBB) && attempts < 10) {
                            lamp.position.x += diff.x * 0.05;
                            lamp.position.z += diff.z * 0.05;
                            attempts++;
                        }
                    }
                }
            }
        }
    }

    // --- Update Falling Letters with Full Verlet Integration ---
    for (let i = fallingLetters.length - 1; i >= 0; i--) {
        const letter = fallingLetters[i];
        const gravityAcc = new THREE.Vector3(0, -9.8, 0);
        verletIntegration(letter, gravityAcc, dt);
        if (letter.position.y < 0) {
            letter.position.y = 0;
            if (letter.userData.previousPosition) {
                letter.userData.previousPosition.y = 0;
            }
        }
    }

    // --- Process Squishing Animations ---
    const processSquish = (letterArray) => {
        for (let i = letterArray.length - 1; i >= 0; i--) {
            const letter = letterArray[i];
            if (letter.userData.squishing) {
                letter.userData.squishElapsed += dt;
                let progress = letter.userData.squishElapsed / letter.userData.squishDuration;
                if (progress > 1) progress = 1;
                letter.scale.y = letter.userData.originalScale.y * (1 - 0.9 * progress);
                if (progress >= 1) {
                    scene.remove(letter);
                    letterArray.splice(i, 1);
                }
            }
        }
    };
    processSquish(staticLetters);
    processSquish(fallingLetters);

    renderer.render(scene, camera);
}
