// lamp_crusher_two.js
import { GpuDevice, GpuMesh, gl } from "./gpu.js"
import { kShaders } from "./shaders.js"
import { Actor, Scene, Camera, Material, SkinnedMaterial, Renderer, DirectionalLight, SpotLight, kGroundMesh, kCubeMesh, load_gltf_model } from './renderer.js'
import { PhysicsEngine } from "./physics_engine.js";

import * as THREE from 'three';
import { Vector2, Vector3, Vector4, Matrix4, Euler } from 'three';
import { initializeUI, updateUI, displayGameOverScreen, removeGameOverScreen } from './ui.js';

const canvas = document.getElementById("gl_canvas");


class Letter extends Actor
{
    constructor(model, material)
    {
        super(model, material, 0.5);
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

async function main()
{
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

    // Toggle for persistent bounding boxes (via 'b')
    let persistentBB = false;

    // Initialize UI elements.
    const { startMenu } = initializeUI();

    // ----- Global Variables for Lamp & Letters -----
    const keyStates = {};

    // Global array to store our OBB helpers.
    let boundingBoxHelpers = [];

    // Camera control variables (for third-person view)
    let cameraRotationX = currentGameMode === 'intro' ? 0 : -0.2;
    let cameraRotationY = 0;
    let cameraDistance = 15;

    // ----- Three.js Scene Setup -----
    const renderer = new Renderer();
    const physics  = new PhysicsEngine();

    const scene  = new Scene();
    const camera = new Camera( 75.0 * Math.PI / 180.0 );
    camera.transform.setPosition(0, 3, 5);
    scene.camera = camera;

    // ---------- Event Listeners --------------
    window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        keyStates[key] = true;
        // Toggle persistent bounding boxes when 'b' is pressed.
        if (key === 'b') {
            persistentBB = !persistentBB;
            console.log("Persistent bounding boxes toggled:", persistentBB);
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



    const letterMaterial = new Material(kShaders.PS_PBRMaterial, { g_Diffuse: [0.0, 0.0, 0.0], g_Roughness: 0.1, g_Metallic: 0.5 });
    const lampMaterial   = new SkinnedMaterial(kShaders.PS_PBRMaterial, { g_Diffuse: [1.0, 1.0, 1.0], g_Roughness: 0.1, g_Metallic: 0.5 });
    const lampModel      = await load_gltf_model('lamp.glb', new Matrix4().makeRotationX( Math.PI / 2 ).multiply( new Matrix4().makeScale( 3, 3, 3 ) ));
    const letterModels   = {
      'p': await load_gltf_model('pixar_p.glb'),
      'i': await load_gltf_model('pixar_i.glb'),
      'x': await load_gltf_model('pixar_x.glb'),
      'a': await load_gltf_model('pixar_a.glb'),
      'r': await load_gltf_model('pixar_r.glb'),
    }

    const lamp = new Lamp(lampModel, lampMaterial);
    lamp.set_position_euler_scale(new Vector3(0, 0, -10), new Euler(0, -Math.PI / 2, 0, 'XYZ'), new Vector3(1, 1, 1));
    scene.add(lamp);

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

    const staticLetters = [];
    const fallingLetters = [];

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

    // ----- OBB Helper Functions -----
    // Compute the eight corners of an oriented bounding box.
    function computeOBBCorners(obb) {
        const { center, axes, halfSizes } = obb;
        const corners = [];
        for (let dx of [-1, 1]) {
            for (let dy of [-1, 1]) {
                for (let dz of [-1, 1]) {
                    let corner = new THREE.Vector3().copy(center);
                    corner.add(new THREE.Vector3().copy(axes[0]).multiplyScalar(dx * halfSizes.x));
                    corner.add(new THREE.Vector3().copy(axes[1]).multiplyScalar(dy * halfSizes.y));
                    corner.add(new THREE.Vector3().copy(axes[2]).multiplyScalar(dz * halfSizes.z));
                    corners.push(corner);
                }
            }
        }
        return corners;
    }

    // Initial load of static letters
    spawnStaticLetters();

    // ----- Dynamic Spawning of Falling Letters -----
    const spawnFallingLetter = () =>
    {
        if (!gameStarted || gameOver) return;
        const letters = ['p', 'i', 'x', 'a', 'r'];
        const randomLetter = letters[Math.floor(Math.random() * letters.length)];
        const posX = Math.random() * 20 - 10;
        const posY = 20;
        const posZ = Math.random() * 20 - 10;

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
        // ambientLight.intensity = 1.5;

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
        if (lamp) {
            lamp.set_position(new Vector3(-3, 0, 5));
            lamp.set_euler(new Euler(0, -Math.PI / 2, 0, 'ZXY'));
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
            // ambientLight.intensity = (health / 100) * 0.5;

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
                    console.log( `${lamp.walk_t}` );
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
                    lamp.walk_t = Math.min( lamp.walk_t + kWalkAnimSpeed * dt, 1.0 );
                }

                // Jump when space is pressed.
                if (keyStates[' '] && !lampIsJumping) {
                    lampIsJumping = true;
                    lamp.jump_t   = 0.0;
                    lamp.add_force(new Vector3(0.0, jumpStrength, 0.0));
                }
            }
            // In the intro state, auto-jump for idle animation.
            if (currentGameMode === 'intro' && !lampIsJumping) {
                lampIsJumping = true;
                lamp.jump_t   = 0.0;
                lamp.add_force(new Vector3(0.0, jumpStrength, 0.0));
            }
            // Process jumping
            const clamp = ( x, min, max ) => Math.min( Math.max( x, min ), max );
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
                camera.transform.setPosition(lamp.get_position().add(offset));
                camera.look_at(lamp.get_position());
            }

            // ----- Lamp-Letter Collision Handling -----
// ----- Lamp-Letter Collision Handling -----
            const lampOBB = getOBB(lamp, lampCollisionScale);
            const allLetters = staticLetters.concat(fallingLetters);

            for (let i = allLetters.length - 1; i >= 0; i--) {
                const letter = allLetters[i];
                const letterOBB = getOBB(letter, letterCollisionScale);

                if (obbIntersect(lampOBB, letterOBB)) {
                    // Determine if both lamp and letter are on the ground.
                    const lampGrounded = lamp.is_grounded();
                    const letterGrounded = Math.abs(letter.get_position().y) < 0.1; // assume letter rests at y ~ 0

                    if (lampGrounded && letterGrounded) {
                        // Both are on the ground. Compute the MTV on the XZ plane.
                        const correction = resolveCollisionMTV(lampOBB, letterOBB);
                        // Update the lamp's position (create a new vector and call set_position).
                        const newPos = lamp.get_position().clone().add(correction);
                        lamp.set_position(newPos);

                        // After correcting the position, update lampOBB for further checks.
                        // (Optionally, you can re-compute lampOBB here if needed.)
                    } else {
                        // If the lamp is airborne:
                        if (lamp.get_position().y > letter.get_position().y + 0.5) {
                            if (!letter.squishing) {
                                letter.squishing = true;
                                letter.squishElapsed = 0;
                                letter.squishDuration = squishDuration;
                                letter.originalScale = letter.get_scale().clone();
                                score += 10;
                                health = Math.min(100, health + 10);
                            }
                        } else {
                            // Otherwise, if airborne but not far enough above, use MTV resolution as well.
                            const correction = resolveCollisionMTV(lampOBB, letterOBB);
                            const newPos = lamp.get_position().clone().add(correction);
                            lamp.set_position(newPos);
                        }
                    }
                    // (Optionally update lampOBB after position change.)
                }
            }



        }

        // Process squishing animations for both static and falling letters.
        const processSquish = (letterArray) => {
            for (let i = letterArray.length - 1; i >= 0; i--) {
                const letter = letterArray[i];
                if (letter.squishing) {
                    letter.squishElapsed += dt;
                    let progress = letter.squishElapsed / letter.squishDuration;
                    if (progress > 1) progress = 1;
                    letter.get_scale().y = letter.originalScale.y * (1 - 0.9 * progress);
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
        physics.fixed_update( scene, time );

        // -------- Bounding Box Visualization --------
        // Draw the bounding boxes if the game is paused (via 'p') or if persistent mode is enabled (toggled via 'b').
        /*
        if (healthDecreasePaused && persistentBB) {
            // Remove any existing helpers
            boundingBoxHelpers.forEach(helper => scene.remove(helper));
            boundingBoxHelpers = [];
            // Create new helpers using our OBB (not the axis-aligned BoxHelper).
            if (lamp) {
                let obb = getOBB(lamp, lampCollisionScale);
                let helper = createOBBHelper(obb, 0xff0000);
                scene.add(helper);
                boundingBoxHelpers.push(helper);
            }
            staticLetters.forEach(obj => {
                let obb = getOBB(obj, letterCollisionScale);
                let helper = createOBBHelper(obb, 0x00ff00);
                scene.add(helper);
                boundingBoxHelpers.push(helper);
            });
            fallingLetters.forEach(obj => {
                let obb = getOBB(obj, letterCollisionScale);
                let helper = createOBBHelper(obb, 0x0000ff);
                scene.add(helper);
                boundingBoxHelpers.push(helper);
            });
        } else {
            boundingBoxHelpers.forEach(helper => scene.remove(helper));
            boundingBoxHelpers = [];
        }
        */

        update_spot_light();

        renderer.draw_obb( lamp.transform, lamp.aabb, new Vector4( 1.0, 0.0, 0.0, 1.0 ) );
        staticLetters.forEach( letter => renderer.draw_obb( letter.transform, letter.aabb, new Vector4( 0.0, 1.0, 0.0, 1.0 ) ));
        fallingLetters.forEach( letter => renderer.draw_obb( letter.transform, letter.aabb, new Vector4( 0.0, 0.0, 1.0, 1.0 ) ));

        lamp.mesh.skeleton.draw_debug( renderer, lamp.transform );

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