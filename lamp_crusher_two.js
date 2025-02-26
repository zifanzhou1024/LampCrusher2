import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// ---------- Game State & UI Variables --------------
let gameStarted = false;
let gameOver = false;
let health = 100;
let score = 0;
let startTime = 0;
let letterSpawnTimer = 0;          // accumulates time for spawning falling letters
let currentSpawnInterval = 2;      // initial spawn interval (in seconds)

// Create UI elements: Start Menu and Health/Score overlay.
const startMenu = document.createElement('div');
startMenu.id = 'startMenu';
startMenu.style.position = 'absolute';
startMenu.style.top = '50%';
startMenu.style.left = '50%';
startMenu.style.transform = 'translate(-50%, -50%)';
startMenu.style.textAlign = 'center';
startMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
startMenu.style.padding = '20px';
startMenu.style.borderRadius = '10px';
startMenu.style.zIndex = '9999';

const titleElement = document.createElement('h1');
titleElement.textContent = 'Lamp Crusher';
titleElement.style.color = 'white';
titleElement.style.marginBottom = '20px';

const startButton = document.createElement('button');
startButton.textContent = 'Start Game';
startButton.style.padding = '10px 20px';
startButton.style.fontSize = '18px';
startButton.style.backgroundColor = '#4CAF50';
startButton.style.color = 'white';
startButton.style.border = 'none';
startButton.style.borderRadius = '5px';
startButton.style.cursor = 'pointer';
startButton.addEventListener('click', startGame);

startMenu.appendChild(titleElement);
startMenu.appendChild(startButton);
document.body.appendChild(startMenu);

const healthAndScoreElement = document.createElement('div');
healthAndScoreElement.id = 'healthAndScore';
healthAndScoreElement.style.position = 'absolute';
healthAndScoreElement.style.top = '10px';
healthAndScoreElement.style.left = '50%';
healthAndScoreElement.style.transform = 'translateX(-50%)';
healthAndScoreElement.style.color = 'white';
healthAndScoreElement.style.fontSize = '20px';
healthAndScoreElement.style.fontFamily = 'Arial, sans-serif';
healthAndScoreElement.style.zIndex = '9999';
healthAndScoreElement.textContent = `Health: ${health} | Score: ${score}`;
document.body.appendChild(healthAndScoreElement);

// ---------- End of Game State & UI Variables --------------


// ----- Custom OBB Functions with Collision Scale -----
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

// ----- Scene, Camera, Renderer Setup -----
const scene = new THREE.Scene();
// Set the background (sky) to blue #6689FF.
scene.background = new THREE.Color(0x6689FF);

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
// Ground material color set to blue #6689FF.
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x6689FF });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// ----- Lights -----
// Ambient light color set to blue #6689FF.
const ambientLight = new THREE.AmbientLight(0x6689FF, 0.5);
scene.add(ambientLight);

// Create a spotlight for the lamp that is pure white and 3x brighter than before.
// Its cone angle is 45°.
const lampLight = new THREE.SpotLight(0xffffff, 6, 100, Math.PI / 4, 0.1, 1);
// Set the spotlight to be emitted from the center of the lamp.
lampLight.position.set(0, 0, 0);
// Set the target so that the beam shoots forward (assumed -Z) and 45° downward.
// Here, the target is set to (0, -1, -1) relative to the lamp.
lampLight.target.position.set(0, -1, -1);
scene.add(lampLight);
scene.add(lampLight.target);

// ----- Global Variables for Lamp Control -----
let lamp = null; // the lamp object once loaded.
const keyStates = {};
let firstPersonView = false;  // default to third-person view.
let vKeyPressed = false;      // prevent continuous toggling.

const staticLetters = [];
const fallingLetters = [];

let cameraRotationX = 0;
let cameraRotationY = 0;
let cameraDistance = 15;

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
let lampJumpVelocity = 0;
let lampIsJumping = false;
const gravity = -9.8;
const jumpStrength = 5;
let lampInitialY = 0;

const clock = new THREE.Clock();

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
            // Attach the spotlight to the lamp so it emits from its center.
            lamp.add(lampLight);
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

// ---------- Game Over Screen --------------
function displayGameOver() {
    const gameOverDiv = document.createElement('div');
    gameOverDiv.id = 'gameOver';
    gameOverDiv.style.position = 'absolute';
    gameOverDiv.style.top = '50%';
    gameOverDiv.style.left = '50%';
    gameOverDiv.style.transform = 'translate(-50%, -50%)';
    gameOverDiv.style.textAlign = 'center';
    gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    gameOverDiv.style.padding = '20px';
    gameOverDiv.style.borderRadius = '10px';
    gameOverDiv.style.zIndex = '9999';

    const gameOverText = document.createElement('h1');
    gameOverText.textContent = 'Game Over';
    gameOverText.style.color = 'white';
    gameOverText.style.marginBottom = '20px';

    const playAgainButton = document.createElement('button');
    playAgainButton.textContent = 'Play Again';
    playAgainButton.style.padding = '10px 20px';
    playAgainButton.style.fontSize = '18px';
    playAgainButton.style.backgroundColor = '#4CAF50';
    playAgainButton.style.color = 'white';
    playAgainButton.style.border = 'none';
    playAgainButton.style.borderRadius = '5px';
    playAgainButton.style.cursor = 'pointer';
    playAgainButton.addEventListener('click', resetGame);

    gameOverDiv.appendChild(gameOverText);
    gameOverDiv.appendChild(playAgainButton);
    document.body.appendChild(gameOverDiv);
}

// ---------- Start and Reset Game Functions --------------
function startGame() {
    gameStarted = true;
    gameOver = false;
    health = 100;
    score = 0;
    startTime = performance.now();
    letterSpawnTimer = 0;
    currentSpawnInterval = 2;
    startMenu.style.display = 'none';
}

function resetGame() {
    const gameOverDiv = document.getElementById('gameOver');
    if (gameOverDiv) gameOverDiv.remove();
    gameStarted = false;
    gameOver = false;
    health = 100;
    score = 0;
    startTime = 0;
    letterSpawnTimer = 0;
    currentSpawnInterval = 2;
    fallingLetters.forEach(letter => scene.remove(letter));
    fallingLetters.length = 0;
    if (lamp) {
        lamp.position.set(0, 0, -10);
    }
    startMenu.style.display = 'block';
}

// ----- Animation Loop -----
function animate() {
    const dt = clock.getDelta();

    if (gameStarted && !gameOver) {
        let elapsedTime = (performance.now() - startTime) / 1000;
        let healthDecreaseRate = 1 + Math.floor(elapsedTime / 10);
        health -= 10 * healthDecreaseRate * dt;
        if (health <= 0) {
            health = 0;
            gameOver = true;
            displayGameOver();
        }
        healthAndScoreElement.textContent = `Health: ${Math.floor(health)} | Score: ${score}`;
        ambientLight.intensity = (health / 100) * 0.5;
        letterSpawnTimer += dt;
        if (letterSpawnTimer >= currentSpawnInterval) {
            spawnFallingLetter();
            letterSpawnTimer = 0;
            currentSpawnInterval = Math.max(0.5, 2 - elapsedTime * 0.1);
        }
    }

    if (lamp) {
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
            lamp.position.add(move.multiplyScalar(speed));
            lamp.rotation.y = Math.atan2(move.x, move.z);
        }
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
        lampLight.position.set(lamp.position.x, lamp.position.y, lamp.position.z);
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
    }

    if (lamp) {
        const lampOBB = getOBB(lamp, lampCollisionScale);
        const allLetters = staticLetters.concat(fallingLetters);
        for (let i = allLetters.length - 1; i >= 0; i--) {
            const letter = allLetters[i];
            const letterOBB = getOBB(letter, letterCollisionScale);
            if (obbIntersect(lampOBB, letterOBB)) {
                if (lampJumpVelocity < 0 && lamp.position.y > letter.position.y + 0.5) {
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

    for (let i = fallingLetters.length - 1; i >= 0; i--) {
        const letter = fallingLetters[i];
        letter.userData.velocityY += -4.9 * dt;
        letter.position.y += letter.userData.velocityY * dt;
        if (letter.position.y <= 0) {
            letter.position.y = 0;
        }
    }

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
