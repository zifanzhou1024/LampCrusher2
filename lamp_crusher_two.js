// lamp_crusher_two.js
import { GpuDevice, GpuMesh, gl } from "./gpu.js"
import { kShaders } from "./shaders.js"
import { Actor, Scene, Camera, Material, SkinnedMaterial, Renderer, DirectionalLight, SpotLight, kGroundMesh, kCubeMesh, load_gltf_model } from './renderer.js'
import { PhysicsEngine } from "./physics_engine.js";

import * as THREE from 'three';
import { Vector2, Vector3, Vector4, Matrix4, Euler } from 'three';
import { initializeUI, updateUI, displayGameOverScreen, removeGameOverScreen, spawnScorePopup, displayWinScreen, createModeSelectionMenu } from './ui.js';

const canvas = document.getElementById("gl_canvas");


class Letter extends Actor
{
    constructor(model, material)
    {
        super(model, material, 0.5);
        this.spring_ks          = 3000;
        this.spring_kd          = 20;

        //add
        this.restHeight = this.aabb.clone().getSize(new Vector3()).y;
        this.currentRestFactor = 1.0;
        this.type = 'letter';
        //add

        this.squishing = false;
        this.squishElapsed = 0.0;
        this.squishDuration = 0.0;
        this.original_scale = this.get_scale();
        this.hasHitGround = false;
    }
}

class Lamp extends Actor
{
    constructor(model, material)
    {
        super(model, material, 0.2);
        this.jump_t = 0.0;
        this.walk_t = 0.0;
    }
}

// Global array to hold active particles.
const particles = [];

// A Particle is an Actor that uses a small black cube.
// It lives for a short time and then is removed.
class Particle extends Actor {
    constructor(material) {
        // mass 0 because these particles are nonphysical.
        super(kCubeMesh, material, 0.0);
        // Set a smaller scale for the particle so it's more like a tiny square piece.
        this.set_scale(new Vector3(0.2, 0.2, 0.2));
        this.lifetime = 0.8;  // shorter lifetime for a burst effect
        this.age = 0.0;
        this.velocity = new Vector3();
        this.toRemove = false;
    }
    update(dt) {
        this.age += dt;
        if (this.age >= this.lifetime) {
            this.toRemove = true;
        } else {
            const pos = this.get_position().clone();
            pos.add(this.velocity.clone().multiplyScalar(dt));
            this.set_position(pos);
        }
    }
}




async function main()
{
    // ---------- Game State Variables --------------
    let gameStarted = false;
    let gameOver = false;
    let gameWin = false;
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

    const kMaxLetters = 64;

    // Toggle for persistent bounding boxes (via 'b')
    let debugDraw = false;

    // Initialize UI elements.
    const { startMenu } = initializeUI();

    // ----- Global Variables for Lamp & Letters -----
    const keyStates = {};

    // Global array to store our OBB helpers.
    let boundingBoxHelpers = [];

    // Camera control variables (for third-person view)
    let cameraRotationX = currentGameMode === 'intro' ? 0 : -0.2;
    let cameraRotationY = 0;
    let cameraDistance = 10;

    // ----- Three.js Scene Setup -----
    const renderer = new Renderer();
    const physics  = new PhysicsEngine();

    const scene  = new Scene();
    const camera = new Camera( 75.0 * Math.PI / 180.0 );
    camera.transform.setPosition(0, 3, 5);
    scene.camera = camera;
    scene.score = 0;

    // ---------- Event Listeners --------------
    window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        keyStates[key] = true;
        // Toggle persistent bounding boxes when 'b' is pressed.
        if (key === 'b') {
            debugDraw = !debugDraw;
            console.log("Debug draw toggled:", debugDraw);
        }
        // Only allow toggling views outside the intro state.
        if (key === 'v' && !vKeyPressed && currentGameMode !== 'intro') {
            firstPersonView = !firstPersonView;
            vKeyPressed = true;
            console.log("View mode toggled. First-person:", firstPersonView);
        }
        if (key === 'p' && !pKeyPressed) {
            // 'p' already toggles healthDecreasePaused (the pause state)
            healthDecreasePaused = !healthDecreasePaused;
            pKeyPressed = true;
            console.log("Health decrease paused (pause state):", healthDecreasePaused);
        }

        if (key === '`') {
            renderer.cycle_blit_buffer();
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
        if (document.pointerLockElement === canvas && currentGameMode !== 'intro') {
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
    const jumpStrength = 300;

    const clock = new THREE.Clock();

    // Only request pointer lock if not in intro state
    canvas.addEventListener('click', () => {
        if (currentGameMode !== 'intro') {
            canvas.requestPointerLock();
        }
    });



    const letterMaterial   = new Material(kShaders.PS_PBRMaterial, { g_Diffuse: [0.0, 0.0, 0.0], g_Roughness: 0.1, g_Metallic: 0.5 });
    const lampMaterial     = new SkinnedMaterial(kShaders.PS_PBRMaterial, { g_Diffuse: [1.0, 1.0, 1.0], g_Roughness: 0.1, g_Metallic: 0.5 });
    const particleMaterial = new Material(kShaders.PS_PBRMaterial, { g_Diffuse: [0.0, 0.0, 0.0], g_Roughness: 1.0, g_Metallic: 0.0 });
    const lampModel        = await load_gltf_model('lamp.glb', new Matrix4().makeRotationX( Math.PI / 2 ).multiply( new Matrix4().makeScale( 3, 3, 3 ) ));
    const letterModels     = {
      'p': await load_gltf_model('pixar_p.glb'),
      'i': await load_gltf_model('pixar_i.glb'),
      'x': await load_gltf_model('pixar_x.glb'),
      'a': await load_gltf_model('pixar_a.glb'),
      'r': await load_gltf_model('pixar_r.glb'),
    }

    const lamp = new Lamp(lampModel, lampMaterial);
    lamp.set_position_euler_scale(new Vector3(-3, 0, 5), new Euler(0, -Math.PI / 2, 0, 'XYZ'), new Vector3(1, 1, 1));
    scene.add(lamp);
    window.lamp = lamp;  // <-- expose lamp globally for use in the particle spawner

    scene.spot_light = new SpotLight(
      new Vector3(),
      new Vector3(),
      new Vector3( 1, 1, 1 ),
      10.0,
      Math.PI / 9,
      Math.PI / 6,
    );

    const update_spot_light = () =>
    {
      const pos = ( new Vector4(0.0,  1.0,  0.5, 1.0) ).applyMatrix4( lamp.transform );
      const dir = ( new Vector4(0.0, -0.5,  1.0, 0.0) ).applyMatrix4( lamp.transform );
      scene.spot_light.position  = new Vector3(pos.x, pos.y, pos.z);
      scene.spot_light.direction = new Vector3(dir.x, dir.y, dir.z).normalize();
    }

    let staticLetters = [];
    let fallingLetters = [];

    const spawnStaticLetters = () =>
    {
      const spawnStaticLetter = (letter, x, y, z) =>
      {
        const actor = new Letter(letterModels[letter], letterMaterial);
        actor.set_position(new Vector3(x, y, z));
        actor.set_euler(new Euler(0, -Math.PI / 2, 0, 'ZXY'));

        scene.add(actor);
        staticLetters.push(actor);
      }

      spawnStaticLetter('p', -8, 0, 0);
      spawnStaticLetter('i', -4, 0, 0);
      spawnStaticLetter('x',  0, 0, 0);
      spawnStaticLetter('a',  4, 0, 0);
      spawnStaticLetter('r',  8, 0, 0);
    }

    const spawnCrushParticles = (scene, position) => {
      // If the letter is near the lamp, offset the spawn position upward
      if (window.lamp && position.distanceTo(window.lamp.get_position()) < 5) {
        position = position.clone().add(new Vector3(0, 1, 0));
      }
      const particleCount = 30;  // Number of particles per crushed letter
      for (let i = 0; i < particleCount; i++) {
        const particle = new Particle(particleMaterial);
        particle.set_position(position.clone());
        // Generate a random upward direction:
        const theta = Math.random() * 2 * Math.PI;             // azimuth (full circle)
        const alpha = Math.random() * (Math.PI / 2);             // polar angle from vertical (0 = up, π/2 = horizontal)
        const speed = Math.random() * 30 + 10; // speed between 10 and 40 units/sec
        const vx = speed * Math.sin(alpha) * Math.cos(theta);
        const vy = speed * Math.cos(alpha);  // always non-negative
        const vz = speed * Math.sin(alpha) * Math.sin(theta);
        particle.velocity = new Vector3(vx, vy, vz);
        scene.add(particle);
        particles.push(particle);
      }
    }
    window.spawnCrushParticles = spawnCrushParticles;

    // ----- Ground -----
    const ground = new Actor(
        kGroundMesh,
        new Material(
            kShaders.PS_PBRMaterial,
            { 
                g_Diffuse: [ 0.403, 0.538, 1.768 ],
                g_Roughness: 1.0,
                g_Metallic: 0.1,
            } 
        ),
        0.0
    );
    ground.mesh.name = "Ground";
    scene.add(ground);

    // ----- Lights -----
    scene.directional_light = new DirectionalLight( new Vector3( -1, -1, -1 ), new Vector3( 1, 1, 1 ), 7 );


    // ----- Custom OBB Functions -----
    // Computes an oriented bounding box from an object.
    function getOBB(object, collisionScale = 1) {
        const aabb = object.aabb;
        // Get the AABB center in local space...
        let center = new THREE.Vector3();
        aabb.getCenter(center);
        // ...and transform it into world space.
        center.applyMatrix4(object.transform);

        // Get the local size from the AABB.
        let size = new THREE.Vector3();
        aabb.getSize(size);

        // Extract the scale factors from the transform matrix.
        const m = object.transform;
        const scaleX = new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]).length();
        const scaleY = new THREE.Vector3(m.elements[4], m.elements[5], m.elements[6]).length();
        const scaleZ = new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10]).length();

        // Compute the world half-sizes.
        const halfSizes = new THREE.Vector3(
            (size.x * scaleX) * 0.5 * collisionScale,
            (size.y * scaleY) * 0.5 * collisionScale,
            (size.z * scaleZ) * 0.5 * collisionScale,
        );

        // Get the axes from the transform (rotation component).
        const axes = [
            new THREE.Vector3(m.elements[0], m.elements[1], m.elements[2]).normalize(),
            new THREE.Vector3(m.elements[4], m.elements[5], m.elements[6]).normalize(),
            new THREE.Vector3(m.elements[8], m.elements[9], m.elements[10]).normalize()
        ];

        return { center, axes, halfSizes };
    }

    // Initial load of static letters
    spawnStaticLetters();

    // ----- Dynamic Spawning of Falling Letters -----
    const spawnFallingLetter = () =>
    {
        if (!gameStarted || gameOver) return;
        const letters = ['p', 'i', 'x', 'a', 'r'];
        const randomLetter = letters[Math.floor(Math.random() * letters.length)];
        const posX = Math.random() * 40 - 20;
        const posY = 40;
        const posZ = Math.random() * 40 - 20;

        const actor = new Letter(letterModels[randomLetter], letterMaterial);
        actor.set_position(new Vector3(posX, posY, posZ));
        actor.set_euler(new Euler(0, -Math.PI / 2, 0, 'ZXY'));

        scene.add(actor);
        fallingLetters.push(actor);
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
    // New: Winning state function using gameWin.
    function displayWin() {
        gameWin = true;
        document.exitPointerLock();
        displayWinScreen(resetGame);
    }


    function startGame(mode = 'normal') {
        currentGameMode = mode;  // mode is 'easy', 'normal', 'hard', or 'demo'
        gameStarted = true;
        gameOver = false;

        // Set starting health: 100 for easy; 50 for normal/hard; demo mode stays 400.
        if (mode === 'easy') {
            scene.health = 100;
        } else if (mode === 'demo') {
            scene.health = 400;
        } else {
            scene.health = 50;
        }

        scene.score = 0;
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
        gameWin = false;
        currentGameMode = 'intro';

        // Reset health & stats for the "intro" state
        scene.health = 100;
        scene.score = 0;
        startTime = 0;
        letterSpawnTimer = 0;
        currentSpawnInterval = 2;

        // Immediately update UI so values reflect 100 health, 0 score/time
        updateUI(scene.health, scene.score, 0);

        // Restore ambient light to original intensity for the intro
        scene.directional_light.luminance = 7;

        // Remove any falling letters from the scene
        fallingLetters.forEach(letter => scene.remove(letter));
        fallingLetters.length = 0;

        // Remove static letters from the scene (in case they were squished)
        staticLetters.forEach(letter => scene.remove(letter));
        staticLetters.length = 0;

        // Reload the static letters
        spawnStaticLetters();

        // Remove any leftover particle systems
        activeParticles.forEach(ps => scene.remove(ps));
        activeParticles.length = 0;

        // Reset lamp to its original position/rotation
        lamp.set_position(new Vector3(-3, 0, 5));
        lamp.set_euler(new Euler(0, -Math.PI / 2, 0, 'ZXY'));
        lampIsJumping = false;

        // ---- Recreate only the Start Menu (without duplicating UI elements) ----
        const existingStartMenu = document.getElementById('startMenu');
        if (existingStartMenu) {
            existingStartMenu.remove();
        }

        const startMenu = document.createElement('div');
        startMenu.id = 'startMenu';
        startMenu.style.position = 'absolute';
        startMenu.style.top = '65%';
        startMenu.style.left = '50%';
        startMenu.style.transform = 'translate(-50%, -50%)';
        startMenu.style.textAlign = 'center';
        startMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        startMenu.style.padding = '20px';
        startMenu.style.borderRadius = '10px';
        startMenu.style.zIndex = '9999';

        const titleElement = document.createElement('h1');
        titleElement.textContent = 'Lamp Crusher 2';
        titleElement.style.color = 'white';
        titleElement.style.marginBottom = '20px';

        const playNowButton = document.createElement('button');
        playNowButton.textContent = 'Play Now';
        playNowButton.style.padding = '10px 20px';
        playNowButton.style.fontSize = '18px';
        playNowButton.style.backgroundColor = '#4CAF50';
        playNowButton.style.color = 'white';
        playNowButton.style.border = 'none';
        playNowButton.style.borderRadius = '5px';
        playNowButton.style.cursor = 'pointer';
        playNowButton.addEventListener('click', () => {
            startMenu.remove();
            createModeSelectionMenu();
        });

        const demoButton = document.createElement('button');
        demoButton.textContent = 'Demo Mode';
        demoButton.style.padding = '10px 20px';
        demoButton.style.fontSize = '18px';
        demoButton.style.backgroundColor = '#4CAF50';
        demoButton.style.color = 'white';
        demoButton.style.border = 'none';
        demoButton.style.borderRadius = '5px';
        demoButton.style.cursor = 'pointer';
        demoButton.style.marginLeft = '10px';
        demoButton.addEventListener('click', () => {
            if (window.startGame) {
                window.startGame('demo');
            }
            const infoBox = document.getElementById('infoBox');
            if (infoBox) infoBox.remove();
            startMenu.remove();
        });

        startMenu.appendChild(titleElement);
        startMenu.appendChild(playNowButton);
        startMenu.appendChild(demoButton);
        document.body.appendChild(startMenu);
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

        // scene.add(points);
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
    // Helper: compute a 2D AABB (on XZ plane) from an OBB.
    function getXZBounds(obb) {
        const corners = computeOBBCorners(obb);
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (let corner of corners) {
            minX = Math.min(minX, corner.x);
            maxX = Math.max(maxX, corner.x);
            minZ = Math.min(minZ, corner.z);
            maxZ = Math.max(maxZ, corner.z);
        }
        return { minX, maxX, minZ, maxZ };
    }
    function resolveCollisionMTV(lampOBB, letterOBB) {
        // Compute the XZ bounds for each OBB.
        const lampBounds = getXZBounds(lampOBB);
        const letterBounds = getXZBounds(letterOBB);

        // Compute the centers.
        const lampCenterX = (lampBounds.minX + lampBounds.maxX) / 2;
        const lampCenterZ = (lampBounds.minZ + lampBounds.maxZ) / 2;
        const letterCenterX = (letterBounds.minX + letterBounds.maxX) / 2;
        const letterCenterZ = (letterBounds.minZ + letterBounds.maxZ) / 2;

        // Compute overlap along X and Z.
        const overlapX = Math.min(lampBounds.maxX, letterBounds.maxX) - Math.max(lampBounds.minX, letterBounds.minX);
        const overlapZ = Math.min(lampBounds.maxZ, letterBounds.maxZ) - Math.max(lampBounds.minZ, letterBounds.minZ);

        // Choose the axis with the least penetration.
        if (overlapX < overlapZ) {
            // If lamp's center is to the left of letter's center, push left; otherwise push right.
            const pushX = lampCenterX < letterCenterX ? -overlapX : overlapX;
            return new Vector3(pushX, 0, 0);
        } else {
            // For Z axis.
            const pushZ = lampCenterZ < letterCenterZ ? -overlapZ : overlapZ;
            return new Vector3(0, 0, pushZ);
        }
    }


    // ----- Animation Loop -----
    function animate(time) {
        const dt = clock.getDelta();

        // In non-intro modes, update game logic.
        if (currentGameMode !== 'intro' && gameStarted && !gameOver && !gameWin) {
            let elapsedTime = (performance.now() - startTime) / 1000;
            let healthDecreaseRate = 1 + Math.floor(elapsedTime / 10);
            if (!healthDecreasePaused) {
                let decreaseAmount = 10 * healthDecreaseRate * dt;
                if (currentGameMode === 'easy') {
                    decreaseAmount *= 0.5;  // Easy mode: half speed
                } else if (currentGameMode === 'harder') {
                    decreaseAmount *= 2.1;  // Existing hard mode is now even harder (2.1× health decrease)
                } else if (currentGameMode === 'hard') {
                    decreaseAmount *= 1.5;  // New hard mode: 1.5× health decrease
                } else if (currentGameMode === 'demo') {
                    decreaseAmount *= 0.5;  // Demo mode remains unchanged
                }
                scene.health -= decreaseAmount;
            }

            if (scene.health <= 0) {
                scene.health = 0;
                displayGameOver();
            }
            updateUI(scene.health, scene.score, elapsedTime);

            // --- NEW: Check for win condition.
            let winThreshold;
            if (currentGameMode === 'easy') {
                winThreshold = 200;
            } else if (currentGameMode === 'normal') {
                winThreshold = 300;
            } else if (currentGameMode === 'hard') {
                winThreshold = 400;
            } else if (currentGameMode === 'harder') {
                winThreshold = 400;
            } else if (currentGameMode === 'demo') {
                winThreshold = 300;
            }
            if (scene.score >= winThreshold) {
                scene.score = winThreshold;
                displayWin();
            }

            // Dim ambient light as health decreases
            scene.directional_light.luminance = Math.min( ( scene.health / 100 ) * 7, 7 );

            // Spawn letters at intervals
            letterSpawnTimer += dt;
            if (letterSpawnTimer >= currentSpawnInterval && fallingLetters.length < kMaxLetters) {
                spawnFallingLetter();
                letterSpawnTimer = 0;
                // Speed up spawning as time progresses
                currentSpawnInterval = Math.max(0.5, 2 - elapsedTime * 0.1);
                if (currentGameMode === 'hard' || currentGameMode === 'harder'|| currentGameMode === 'easy') {
                    currentSpawnInterval /= 2.5;
                }
            }
        }

        const clamp = ( x, min, max ) => Math.min( Math.max( x, min ), max );

        // ----- Lamp Movement, Jumping, and Rotation -----
        if (currentGameMode !== 'intro' && gameStarted && !gameOver && !gameWin) {
            const speed = 0.15;
            // Get forward/right vectors from camera (flattened on Y).
            const forward = camera.get_forward();
            forward.y = 0;
            forward.normalize();

            const right = new THREE.Vector3();
            right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

            let move = new THREE.Vector3();
            if (keyStates['w']) move.add(forward);
            if (keyStates['s']) move.sub(forward);
            if (keyStates['a']) move.sub(right);
            if (keyStates['d']) move.add(right);

            const kWalkAnimSpeed = 1.5;
            if (move.lengthSq() > 0) {
                lamp.walk_t = ( lamp.walk_t + kWalkAnimSpeed * dt ) % 1;
                move.normalize();
                let prevLampPos = lamp.get_position().clone();
                const pos = lamp.get_position().addScaledVector(move, speed);
                lamp.set_position(pos);

                // --- Smooth Turning Implementation ---
                // Calculate the target angle from the movement vector.
                const targetAngle = Math.atan2(move.x, move.z);
                const rotationSpeed = 0.6; // Adjust for smoother turning.
                let angleDiff = targetAngle - lamp.get_euler().y;
                // Normalize angleDiff to [-π, π]
                angleDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
                const rotation = lamp.get_euler();
                rotation.y += angleDiff * rotationSpeed;
                lamp.set_euler(rotation);
            } else if (lamp.walk_t > 0.0 && lamp.walk_t < 1.0) {
                let walk_dt = kWalkAnimSpeed * dt;
                // Prevent unnecessary step when obviously not started.
                if (lamp.walk_t < 0.4)
                {
                  walk_dt *= -1.0;
                }
                lamp.walk_t   = clamp( lamp.walk_t + walk_dt, 0.0, 1.0 );
            }

            // Jump when space is pressed.
            if (keyStates[' '] && !lampIsJumping) {
                lampIsJumping = true;
                lamp.jump_t   = 0.0;
                lamp.add_force(new Vector3(0.0, jumpStrength, 0.0));
            }
        }
        // In the intro state, auto-jump for idle animation.
        if (currentGameMode === 'intro' && !lampIsJumping && (lamp.jump_t >= 1.0 || lamp.jump_t <= 0.0)) {
            lampIsJumping = true;
            lamp.jump_t   = 0.0;
            lamp.add_force(new Vector3(0.0, jumpStrength * 2, 0.0));
        }
        // Process jumping
        if (lampIsJumping) {
            if ( lamp.get_velocity().y > 0.01 )
            {
              const kJumpAnimSpeed = 1.5;
              const jump_dt        = dt * kJumpAnimSpeed;
              lamp.jump_t          = clamp( lamp.jump_t + jump_dt, 0.0, 0.5 );
            }
            else
            {
              const kJumpAnimSpeed = 0.2;
              const jump_dt        = dt * kJumpAnimSpeed;
              lamp.jump_t          = clamp( lamp.jump_t + jump_dt, 0.0, 0.63 );
            }
            if (lamp.is_grounded()) {
                lampIsJumping = false;
                console.log("Lamp landed!"); // Debug message
                // scene.add(points);
                // spawnParticlesAt(lamp.get_position());
                // renderer.triggerSmoke = true;

                // Create a transformation matrix to position the smoke where the lamp landed.
                const pos = lamp.get_position();
                //console.log("Lamp position:", pos); // ADD THIS

                // Start with a translation to the lamp's position.
                let transform = new Matrix4().makeTranslation(pos.x, pos.y, pos.z);
                //console.log("Translation matrix:", transform.elements); // ADD THIS

                // Rotate the quad so that it lies flat on the ground (adjust rotation as needed).
                const rot = new Euler(-Math.PI / 2, 0, 0, 'XYZ');
                const rotationMat = new Matrix4().makeRotationFromEuler(rot);
                transform.multiply(rotationMat);
                //console.log("After rotation:", transform.elements); // ADD THIS

                // Scale the quad to an appropriate size (adjust scale factors as desired).
                const scaleMat = new Matrix4().makeScale(4, 4, 4);
                transform.multiply(scaleMat);
                //console.log("After scaling:", transform.elements); // ADD THIS

                // Call the new smoke render method with the computed transform.
                // renderer.render_handler_smoke_at(transform);
                // Instead of rendering smoke immediately, store the transform and flag it:
                renderer.smokeTransform = transform;
                renderer.triggerSmoke = true;
            }
        } else {
          const kJumpAnimSpeed = 1.0;
          const jump_dt        = dt * kJumpAnimSpeed;
          lamp.jump_t          = clamp( lamp.jump_t + jump_dt, 0.0, 1.0 );
        }

        if ( !lamp.is_grounded() || lamp.walk_t <= 0.0 || lamp.walk_t >= 1.0 )
        {
          lamp.walk_t = 0.0;
          lamp.update_anim( "Jump", lamp.jump_t );
        }
        else
        {
          lamp.update_anim( "Walk", lamp.walk_t );
        }

        // Update particle systems (fade out / remove)
        updateParticles();
        physics.fixed_update( scene, time );

        // ----- Camera Setup -----
        if (currentGameMode === 'intro') {
            // Intro state: fixed camera position
            camera.transform.setPosition(0, 2, 18);
            camera.look_at(new Vector3(0, 0, 0));
        } else if (firstPersonView) {
            // First-person view: attach camera to lamp’s head.
            const eyeOffset = new THREE.Vector3(0, 1, 0);
            camera.transform.setPosition(lamp.get_position().add(eyeOffset));
            const lookDirection = new THREE.Vector3(
                Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                Math.sin(cameraRotationX),
                Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            camera.look_at(lamp.get_position().add(lookDirection));
        } else {
            // Third-person view: orbit camera around the lamp.
            const offset = new THREE.Vector3(
                cameraDistance * Math.sin(cameraRotationY) * Math.cos(cameraRotationX),
                cameraDistance * Math.sin(cameraRotationX) + 3,
                cameraDistance * Math.cos(cameraRotationY) * Math.cos(cameraRotationX)
            );
            const camera_pos = lamp.get_position().add(offset);
            camera_pos.y = Math.max(camera_pos.y, 0.1);
            camera.transform.setPosition(camera_pos);
            camera.look_at(lamp.get_position());
        }

        update_spot_light();

        staticLetters  = staticLetters.filter( letter => letter.id !== 0 );
        fallingLetters = fallingLetters.filter( letter => letter.id !== 0 );

        // -------- Bounding Box Visualization --------
        // Draw the bounding boxes if the game is paused (via 'p') or if debug draw is enabled (toggled via 'b').
        if ( debugDraw )
        {
          renderer.draw_obb( lamp.transform, lamp.aabb, new Vector4( 1.0, 0.0, 0.0, 1.0 ) );
          staticLetters.forEach( letter => renderer.draw_obb( letter.transform, letter.aabb, new Vector4( 0.0, 1.0, 0.0, 1.0 ) ));
          fallingLetters.forEach( letter => renderer.draw_obb( letter.transform, letter.aabb, new Vector4( 0.0, 0.0, 1.0, 1.0 ) ));

          lamp.mesh.skeleton.draw_debug( renderer, lamp.transform );
        }

        // Update particles: iterate and remove expired ones.
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update(dt);
            if (particles[i].toRemove) {
                scene.remove(particles[i]);
                particles.splice(i, 1);
            }
        }

        renderer.submit(scene);
    }


    const update = (time) => 
    {
        requestAnimationFrame(update);
        animate(time / 1000.0);
    };

    requestAnimationFrame(update)
}


main();
