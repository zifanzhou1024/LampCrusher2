import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// ----- Custom OBB Functions with Collision Scale -----
// Compute an OBB from an Object3D using its world-transformed bounding box,
// then scale the halfSizes to get a tighter collision volume.
function getOBB(object, collisionScale = 1) {
    object.updateWorldMatrix(true, false);
    let aabb = new THREE.Box3().setFromObject(object);
    let center = new THREE.Vector3();
    aabb.getCenter(center);
    let size = new THREE.Vector3();
    aabb.getSize(size);
    // Scale down the halfSizes to tighten the collision volume.
    let halfSizes = size.multiplyScalar(0.5).multiplyScalar(collisionScale);
    // Extract the local axes from the object's world matrix.
    let m = object.matrixWorld;
    let axes = [
        new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]).normalize(),
        new THREE.Vector3(m.elements[4], m.elements[5], m.elements[6]).normalize(),
        new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10]).normalize()
    ];
    return { center, axes, halfSizes };
}

// For a given OBB, compute its projection radius on an axis.
function halfProjection(obb, axis) {
    return obb.halfSizes.x * Math.abs(axis.dot(obb.axes[0])) +
        obb.halfSizes.y * Math.abs(axis.dot(obb.axes[1])) +
        obb.halfSizes.z * Math.abs(axis.dot(obb.axes[2]));
}

// Separating Axis Theorem test for two OBBs.
function obbIntersect(obb1, obb2) {
    let axes = [];
    // Add the three axes of each box.
    axes.push(obb1.axes[0], obb1.axes[1], obb1.axes[2],
        obb2.axes[0], obb2.axes[1], obb2.axes[2]);
    // Add cross products of each pair (if nonzero).
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let axis = new THREE.Vector3().crossVectors(obb1.axes[i], obb2.axes[j]);
            if (axis.lengthSq() > 1e-6) {
                axis.normalize();
                axes.push(axis);
            }
        }
    }
    // Compute the translation vector between the centers.
    let tVec = new THREE.Vector3().subVectors(obb2.center, obb1.center);
    // Test for separation along each axis.
    for (let i = 0; i < axes.length; i++) {
        let axis = axes[i];
        let r1 = halfProjection(obb1, axis);
        let r2 = halfProjection(obb2, axis);
        let t = Math.abs(tVec.dot(axis));
        if (t > r1 + r2) {
            return false; // Found a separating axis.
        }
    }
    return true; // No separating axis found.
}

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

// Request pointer lock on click to enable mouse control.
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
let lamp = null; // Will store the lamp object once loaded.
const keyStates = {};
let firstPersonView = false;  // default to third-person view.
let vKeyPressed = false;      // flag to prevent continuous toggling.

// Arrays to keep track of letters for collision and squish animation.
const staticLetters = [];
const fallingLetters = [];

// Mouse-controlled camera rotation angles (in radians).
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
        cameraRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraRotationX));
    }
});

// Variables for jump physics.
let lampJumpVelocity = 0;
let lampIsJumping = false;
const gravity = -9.8;
const jumpStrength = 5;
let lampInitialY = 0;

// THREE.Clock for delta time.
const clock = new THREE.Clock();

// ----- Load the Lamp Model (OBJ + MTL) -----
// Lamp is scaled 3× and now starts at (0, 0, -10) to avoid immediate intersections.
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

// ----- Load Static Letters (remain on the ground) -----
loadLetter('p', -4, 0, 0);
loadLetter('i', -2, 0, 0);
loadLetter('x',  0, 0, 0);
loadLetter('a',  2, 0, 0);
loadLetter('r',  4, 0, 0);

// ----- Dynamic Spawning of Falling Letters -----
const letterGravity = -4.9;
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
                object.userData.velocityY = 0;
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
    const posX = Math.random() * 20 - 10;
    const posY = 20;
    const posZ = Math.random() * 20 - 10;
    loadFallingLetter(randomLetter, posX, posY, posZ);
}
setInterval(spawnFallingLetter, 2000);

// ----- Collision & Squish Animation Parameters -----
const squishDuration = 1;

// Tuning factors: adjust these to make the collision volumes tighter or looser.
const lampCollisionScale = 0.8;
const letterCollisionScale = 0.9;

// ----- Animation Loop -----
function animate() {
    const dt = clock.getDelta();

    if (lamp) {
        const speed = 0.1;
        // --- Lamp Movement ---
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
            lamp.position.add(move.multiplyScalar(speed));
            lamp.rotation.y = Math.atan2(move.x, move.z);
        }
        // --- Lamp Jump Movement ---
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
        lampLight.position.set(lamp.position.x, lamp.position.y + 2, lamp.position.z);
        // --- Camera Control ---
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

    // --- Robust OBB Collision Detection & Response ---
    if (lamp) {
        const lampOBB = getOBB(lamp, lampCollisionScale);
        const allLetters = staticLetters.concat(fallingLetters);
        for (let i = allLetters.length - 1; i >= 0; i--) {
            const letter = allLetters[i];
            const letterOBB = getOBB(letter, letterCollisionScale);
            if (obbIntersect(lampOBB, letterOBB)) {
                // If lamp is descending and coming from above the letter, trigger squish.
                if (lampJumpVelocity < 0 && lamp.position.y > letter.position.y + 0.5) {
                    if (!letter.userData.squishing) {
                        letter.userData.squishing = true;
                        letter.userData.squishElapsed = 0;
                        letter.userData.squishDuration = squishDuration;
                        letter.userData.originalScale = letter.scale.clone();
                    }
                } else {
                    // Otherwise, nudge the lamp horizontally (XZ) to resolve penetration.
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

    // --- Update Falling Letters Movement ---
    for (let i = fallingLetters.length - 1; i >= 0; i--) {
        const letter = fallingLetters[i];
        letter.userData.velocityY += letterGravity * dt;
        letter.position.y += letter.userData.velocityY * dt;
        if (letter.position.y <= 0) {
            letter.position.y = 0;
        }
    }

    // --- Update Squish Animation for All Letters ---
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
