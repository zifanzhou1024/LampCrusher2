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
let letterSpawnTimer = 0;
let currentSpawnInterval = 2;
// Game mode is one of 'intro', 'normal', or 'demo'
let currentGameMode = 'intro';
let healthDecreasePaused = false;  // Allows pausing health decrease

// View toggle variables (only active in non-intro modes)
let firstPersonView = false;  // defaults to third-person view
let vKeyPressed = false;
let pKeyPressed = false;

// Initialize UI elements.
const { startMenu } = initializeUI();

// ----- Global Variables for Lamp & Letters -----
let lamp = null; // Will hold the loaded lamp model.
const keyStates = {};

const staticLetters = [];
const fallingLetters = [];

// Camera control variables (for third-person view)
let cameraRotationX = currentGameMode === 'intro' ? 0 : -0.2;
let cameraRotationY = 0;
let cameraDistance = 15;

// ---------- Event Listeners ----------
window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    keyStates[key] = true;
    // Only allow toggling views outside the intro state.
    if (key === 'v' && !vKeyPressed && currentGameMode !== 'intro') {
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
    // Only apply camera look if pointer lock is active AND we're not in intro
    if (document.pointerLockElement === renderer.domElement && currentGameMode !== 'intro') {
        const sensitivity = 0.002;
        cameraRotationX += event.movementY * sensitivity;
        cameraRotationY -= event.movementX * sensitivity;
        // Clamp vertical rotation so the camera never flips over.
        cameraRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraRotationX));
    }
});
window.addEventListener('wheel', (event) => {
    if (currentGameMode !== 'intro') {
        event.preventDefault();
        cameraDistance += event.deltaY * 0.01;
        cameraDistance = Math.max(5, Math.min(50, cameraDistance));
    }
});

// Variables for jump physics.
let lampIsJumping = false;
const gravity = -9.8;
const jumpStrength = 6;
let lampInitialY = 0;

const clock = new THREE.Clock();

// ----- Three.js Scene Setup -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x087CEEB);

const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 1000
);
camera.position.set(0, 5, 15);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

// Only request pointer lock if not in intro state
renderer.domElement.addEventListener('click', () => {
    if (currentGameMode !== 'intro') {
        renderer.domElement.requestPointerLock();
    }
});

// ----- Ground -----
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x87CEEB });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// ----- Lights -----
const ambientLight = new THREE.AmbientLight(0xBBDEFB, 1.5);
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
    axes.push(
        obb1.axes[0], obb1.axes[1], obb1.axes[2],
        obb2.axes[0], obb2.axes[1], obb2.axes[2]
    );
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

function verletVerticalIntegration(object, acceleration, dt) {
    if (object.userData.previousY === undefined) {
        object.userData.previousY = object.position.y;
    }
    let currentY = object.position.y;
    let newY = 2 * currentY - object.userData.previousY + acceleration * dt * dt;
    object.userData.previousY = currentY;
    object.position.y = newY;
}

// ----- Helper to Load the Lamp Model (OBJ + MTL) -----
const mtlLoaderLamp = new MTLLoader();
mtlLoaderLamp.setPath('assets/');
mtlLoaderLamp.load('lamp.mtl', (materials) => {
    materials.preload();
    const objLoaderLamp = new OBJLoader();
    objLoaderLamp.setMaterials(materials);
    objLoaderLamp.setPath('assets/');
    objLoaderLamp.load('lamp.obj',
        (object) => {
            object.position.set(-3, 0, 5);
            object.scale.set(3, 3, 3);
            object.rotation.y = -Math.PI / 2;
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

// ----- Functions to Load Static Letters -----
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

// Function to (re)load all static letters (p, i, x, a, r)
function loadAllStaticLetters() {
    loadLetter('p', -8, 0, 0);
    loadLetter('i', -4, 0, 0);
    loadLetter('x',  0, 0, 0);
    loadLetter('a',  4, 0, 0);
    loadLetter('r',  8, 0, 0);
}

// Initial load of static letters
loadAllStaticLetters();

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
                object.userData.previousPosition = object.position.clone();
                object.userData.squishing = false;
                object.userData.hasHitGround = false; // so we only spawn particles once
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

    // Exit pointer lock so the mouse is free
    document.exitPointerLock();

    displayGameOverScreen(resetGame);
}

function startGame(mode = 'normal') {
    // When starting the game, switch from the intro state into either normal or demo mode.
    currentGameMode = mode;  // mode is either 'normal' or 'demo'
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
    // Exit pointer lock if it's active
    document.exitPointerLock();

    removeGameOverScreen();
    gameStarted = false;
    gameOver = false;
    currentGameMode = 'intro';

    // Reset health & stats for the "intro" state
    health = 100;
    score = 0;
    startTime = 0;
    letterSpawnTimer = 0;
    currentSpawnInterval = 2;

    // Immediately update UI so values reflect 100 health, 0 score/time
    updateUI(health, score, 0);

    // Restore ambient light to original intensity for the intro
    ambientLight.intensity = 1.5;

    // Remove any falling letters from the scene
    fallingLetters.forEach(letter => scene.remove(letter));
    fallingLetters.length = 0;

    // Remove static letters from the scene (in case they were squished)
    staticLetters.forEach(letter => scene.remove(letter));
    staticLetters.length = 0;

    // Reload the static letters
    loadAllStaticLetters();

    // Remove any leftover particle systems
    activeParticles.forEach(ps => scene.remove(ps));
    activeParticles.length = 0;

    // Reset lamp to its original position/rotation
    if (lamp) {
        lamp.position.set(-3, 0, 5);
        lamp.rotation.set(0, -Math.PI / 2, 0);
        lamp.userData.previousY = lamp.position.y;
        lampIsJumping = false;
    }

    // Show start menu again
    if (startMenu) {
        startMenu.style.display = 'block';
    }
}

// Expose startGame globally for UI access.
window.startGame = startGame;

/**
 * --------------------------------------------------------------------------
 * PARTICLE SYSTEM IMPLEMENTATION (Smoke-like)
 * --------------------------------------------------------------------------
 */
const activeParticles = [];  // Store active particle systems

function spawnParticlesAt(position) {
    const particleCount = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        // Random initial positions (small spread)
        const randX = (Math.random() - 0.5) * 0.5;
        const randY = Math.random() * 0.5;
        const randZ = (Math.random() - 0.5) * 0.5;
        positions[i * 3]     = position.x + randX;
        positions[i * 3 + 1] = position.y + randY;
        positions[i * 3 + 2] = position.z + randZ;

        // Slight drift velocities (to look like smoke rising / moving sideways)
        const vx = (Math.random() - 0.5) * 0.3;
        const vy = 0.2 + Math.random() * 0.4; // mostly upwards
        const vz = (Math.random() - 0.5) * 0.3;
        velocities[i * 3]     = vx;
        velocities[i * 3 + 1] = vy;
        velocities[i * 3 + 2] = vz;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.2,
        transparent: true,
        opacity: 1.0,
        depthWrite: false  // helps blending for 'smoky' look
    });

    const points = new THREE.Points(geometry, material);
    points.userData.startTime = performance.now();
    points.userData.lastUpdateTime = performance.now();
    points.userData.lifetime = 3000; // 3 seconds for a smoke-like fade

    scene.add(points);
    activeParticles.push(points);
}

function updateParticles() {
    const now = performance.now();
    for (let i = activeParticles.length - 1; i >= 0; i--) {
        const ps = activeParticles[i];
        const elapsed = now - ps.userData.startTime;
        const geometry = ps.geometry;
        const positions = geometry.attributes.position.array;
        const velocities = geometry.attributes.velocity.array;

        // Time since last update
        const frameDt = (now - ps.userData.lastUpdateTime) * 0.001; // convert ms to s
        ps.userData.lastUpdateTime = now;

        // Update each particle's position with velocity
        for (let j = 0; j < positions.length; j += 3) {
            positions[j]   += velocities[j]   * frameDt;
            positions[j+1] += velocities[j+1] * frameDt;
            positions[j+2] += velocities[j+2] * frameDt;
        }
        geometry.attributes.position.needsUpdate = true;

        // Fade out over lifetime
        const ratio = elapsed / ps.userData.lifetime;
        if (ratio >= 1) {
            // Lifetime over
            scene.remove(ps);
            activeParticles.splice(i, 1);
        } else {
            ps.material.opacity = 1 - ratio;  // fade from 1 to 0
        }
    }
}
/**
 * --------------------------------------------------------------------------
 */

// ----- Animation Loop -----
function animate() {
    const dt = clock.getDelta();

    // In non-intro modes, update game logic.
    if (currentGameMode !== 'intro' && gameStarted && !gameOver) {
        let elapsedTime = (performance.now() - startTime) / 1000;
        let healthDecreaseRate = 1 + Math.floor(elapsedTime / 10);
        if (!healthDecreasePaused) {
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

        // Dim ambient light as health decreases
        ambientLight.intensity = (health / 100) * 0.5;

        // Spawn letters at intervals
        letterSpawnTimer += dt;
        if (letterSpawnTimer >= currentSpawnInterval) {
            spawnFallingLetter();
            letterSpawnTimer = 0;
            // Speed up spawning as time progresses
            currentSpawnInterval = Math.max(0.5, 2 - elapsedTime * 0.1);
        }
    }

    // ----- Lamp Movement, Jumping, and Rotation -----
    if (lamp) {
        if (currentGameMode !== 'intro' && gameStarted && !gameOver) {
            const speed = 0.15;
            // Get forward/right vectors from camera (flattened on Y).
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            const right = new THREE.Vector3();
            right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

            let move = new THREE.Vector3();
            if (keyStates['w']) move.add(forward);
            if (keyStates['s']) move.sub(forward);
            if (keyStates['a']) move.sub(right);
            if (keyStates['d']) move.add(right);

            if (move.lengthSq() > 0) {
                move.normalize();
                lamp.position.addScaledVector(move, speed);
                // Rotate lamp to face movement direction.
                lamp.lookAt(
                    lamp.position.x + move.x,
                    lamp.position.y,
                    lamp.position.z + move.z
                );
            }

            // Jump when space is pressed.
            if (keyStates[' '] && !lampIsJumping) {
                lampIsJumping = true;
                lampInitialY = lamp.position.y;
                const dtApprox = 0.016;
                lamp.userData.previousY = lamp.position.y - jumpStrength * dtApprox;
            }
        }
        // In the intro state, auto-jump for idle animation.
        if (currentGameMode === 'intro' && !lampIsJumping) {
            lampIsJumping = true;
            lampInitialY = lamp.position.y;
            const dtApprox = 0.016;
            lamp.userData.previousY = lamp.position.y - jumpStrength * dtApprox;
        }

        // Process jumping
        if (lampIsJumping) {
            verletVerticalIntegration(lamp, gravity, dt);
            if (lamp.position.y < lampInitialY) {
                lamp.position.y = lampInitialY;
                lampIsJumping = false;
                lamp.userData.previousY = lampInitialY;

                // ---- Spawn Particles on Lamp Landing ----
                spawnParticlesAt(lamp.position.clone());
            }
        }

        // ----- Camera Setup -----
        if (currentGameMode === 'intro') {
            // Intro state: fixed camera position
            camera.position.set(0, 2, 18);
            camera.lookAt(new THREE.Vector3(0, 0, 0));
        } else if (firstPersonView) {
            // First-person view: attach camera to lamp’s head.
            const eyeOffset = new THREE.Vector3(0, 1, 0);
            camera.position.copy(lamp.position).add(eyeOffset);
            const lookDirection = new THREE.Vector3(
                Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                Math.sin(cameraRotationX),
                Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.lookAt(lamp.position.clone().add(lookDirection));
        } else {
            // Third-person view: orbit camera around the lamp.
            const offset = new THREE.Vector3(
                cameraDistance * Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                cameraDistance * Math.sin(cameraRotationX) + 3,
                cameraDistance * Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.position.copy(lamp.position).add(offset);
            camera.lookAt(lamp.position);
        }

        // ----- Lamp-Letter Collision Handling -----
        const lampOBB = getOBB(lamp, lampCollisionScale);
        const allLetters = staticLetters.concat(fallingLetters);
        for (let i = allLetters.length - 1; i >= 0; i--) {
            const letter = allLetters[i];
            const letterOBB = getOBB(letter, letterCollisionScale);
            if (obbIntersect(lampOBB, letterOBB)) {
                // If the lamp is above the letter, initiate squish.
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
                    // Otherwise, push them apart horizontally
                    let diff = new THREE.Vector3(
                        lamp.position.x - letter.position.x,
                        0,
                        lamp.position.z - letter.position.z
                    );
                    if (diff.length() > 0.001) {
                        diff.normalize();
                        let attempts = 0;
                        while (
                            obbIntersect(
                                getOBB(lamp, lampCollisionScale),
                                letterOBB
                            ) &&
                            attempts < 10
                            ) {
                            lamp.position.x += diff.x * 0.05;
                            lamp.position.z += diff.z * 0.05;
                            attempts++;
                        }
                    }
                }
            }
        }
    }

    // Update falling letters using Verlet integration, only if not grounded
    for (let i = fallingLetters.length - 1; i >= 0; i--) {
        const letter = fallingLetters[i];
        const gravityAcc = new THREE.Vector3(0, -9.8, 0);
        if (!letter.userData.hasHitGround) {
            verletIntegration(letter, gravityAcc, dt);
        }

        // Check if letter has just hit the ground
        if (letter.position.y < 0 && !letter.userData.hasHitGround) {
            letter.position.y = 0;
            if (letter.userData.previousPosition) {
                letter.userData.previousPosition.y = 0;
            }
            letter.userData.hasHitGround = true;
            // Spawn Particles once when a letter hits the ground
            spawnParticlesAt(letter.position.clone());
        }
    }

    // Process squishing animations for both static and falling letters.
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

    // Update particle systems (fade out / remove)
    updateParticles();

    renderer.render(scene, camera);
}
