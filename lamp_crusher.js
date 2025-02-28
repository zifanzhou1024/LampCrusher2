import { kShaders } from "./shaders.js";
import { Material } from "./renderer.js";

import * as THREE from 'three';
import { Vector2, Vector3, Vector4, Matrix4 } from 'three';

// Lamp source
// https://www.cgtrader.com/free-3d-models/furniture/lamp/pixar-lamp-518a1299-ae8f-4847-ba1a-110d4f68d172

export class LampCrusher {
constructor() {
    this.initScene();
    this.loadAssets();
    this.createUI();
    this.startAnimationLoop();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(5, -10, -30);
    
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);
    
    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.position.set(10, 10, 10);
    this.scene.add(this.light);
  }

  loadAssets() {
    const loader = new OBJLoader();
    const material = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0, metalness: 0.1 });
    
    this.actors = [];
    this.meshes = ["p", "i", "x", "a", "r"].map(letter => {
      const actor = new THREE.Group();
      loader.load(`./assets/pixar_${letter}.obj`, obj => {
        obj.traverse(child => {
          if (child.isMesh) child.material = material;
        });
        actor.add(obj);
      });
      this.scene.add(actor);
      this.actors.push(actor);
      return actor;
    });
    
    this.lamp = new THREE.Group();
    loader.load("./assets/lamp.obj", obj => {
      obj.traverse(child => {
        if (child.isMesh) child.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.5 });
      });
      this.lamp.add(obj);
    });
    this.scene.add(this.lamp);
    
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({ color: 0x6789ff, roughness: 1.0, metalness: 0.1 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
  }

  createUI() {
    const healthElement = document.createElement('div');
    healthElement.id = 'healthAndScore';
    healthElement.style.position = 'absolute';
    healthElement.style.top = '10px';
    healthElement.style.left = '50%';
    healthElement.style.transform = 'translateX(-50%)';
    healthElement.style.color = 'white';
    healthElement.style.fontSize = '20px';
    healthElement.textContent = `Health: 100 | Score: 0`;
    document.body.appendChild(healthElement);

    const startMenuElement = document.createElement('div');
    startMenuElement.id = 'startMenu';
    startMenuElement.style.position = 'absolute';
    startMenuElement.style.top = '50%';
    startMenuElement.style.left = '50%';
    startMenuElement.style.transform = 'translate(-50%, -50%)';
    startMenuElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    startMenuElement.style.padding = '20px';
    startMenuElement.style.borderRadius = '10px';
    
    const titleElement = document.createElement('h1');
    titleElement.textContent = 'Lamp Crusher';
    titleElement.style.color = 'white';
    startMenuElement.appendChild(titleElement);
    
    const startButtonElement = document.createElement('button');
    startButtonElement.textContent = 'Start Game';
    startButtonElement.style.padding = '10px 20px';
    startButtonElement.style.fontSize = '18px';
    startButtonElement.addEventListener('click', () => this.startGame());
    startMenuElement.appendChild(startButtonElement);
    
    document.body.appendChild(startMenuElement);
  }

  make_control_panel() {
    document.addEventListener("mousemove", this.handle_mouse_move.bind(this));
    document.addEventListener("click", this.request_pointer_lock.bind(this));
    document.addEventListener("pointerlockchange", this.handle_pointer_lock_change.bind(this));
    document.addEventListener("mozpointerlockchange", this.handle_pointer_lock_change.bind(this));
    document.addEventListener("wheel", this.handle_mouse_wheel.bind(this));
    
    document.addEventListener("keydown", (e) => {
      if (this.third_person_view) {
        this.key_states[e.key] = true;
      }
    });

    document.addEventListener("keyup", (e) => {
      if (this.third_person_view) {
        this.key_states[e.key] = false;
      }
    });
  }

  showStartMenu() {
    const startMenuElement = document.getElementById('startMenu');
    if (startMenuElement) {
      startMenuElement.style.display = 'block';
    }
  }
  
  hideStartMenu() {
    const startMenuElement = document.getElementById('startMenu');
    if (startMenuElement) {
      startMenuElement.style.display = 'none';
    }
  }


  startGame() {
    this.always_jumping = false; // change to false for intro view
    this.game_started = true;
    this.third_person_view = true;
    this.demo_mode = false;
    this.spawn_interval = setInterval(this.spawnFallingLetter.bind(this), 2000);
    // this.intro_view = false;
    this.hideStartMenu();
    this.startTime = performance.now();
      console.log("Game Started");
      // Start the spawn interval when the game starts
      

  }


  handle_mouse_wheel(e) {
    if (this.third_person_view) {
      const delta = e.deltaY < 0 ? -1 : 1;
      const zoom_speed = 0.1;
      const min_distance = 5;
      const max_distance = 20;
  
      this.camera_distance -= delta * zoom_speed;
      this.camera_distance = Math.max(Math.min(this.camera_distance, max_distance), min_distance);
    }
  }
  handle_mouse_move(e) {
    if (this.third_person_view&& document.pointerLockElement === this.canvas) {
      const dx = e.movementX;
      const dy = e.movementY;
      const sensitivity = 0.002;

      // Update the camera's rotation based on the mouse movement
      this.camera_rotation_x += dy * sensitivity;
      this.camera_rotation_y -= dx * sensitivity;

      // Clamp the vertical rotation to avoid flipping the camera
      this.camera_rotation_x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera_rotation_x));
    }
  }
  unlock_pointer() {
    if (document.pointerLockElement === this.canvas || document.mozPointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }
  handle_pointer_lock_change() {
    // const canvas = document.querySelector("canvas");
    if (this.canvas && (document.pointerLockElement === this.canvas || document.mozPointerLockElement === this.canvas)) {
      console.log("Pointer locked");
      document.addEventListener("mousemove", this.handle_mouse_move.bind(this));
      document.addEventListener("wheel", this.handle_mouse_wheel.bind(this), { passive: false });
      document.addEventListener("wheel", this.prevent_default_behavior, { passive: false });
    } else {
      console.log("Pointer unlocked");
      document.removeEventListener("mousemove", this.handle_mouse_move);
      document.removeEventListener("wheel", this.handle_mouse_wheel);
      document.removeEventListener("wheel", this.prevent_default_behavior);
    }
  }

  prevent_default_behavior(e) {
    e.preventDefault();
  }

  // Function to get the Oriented Bounding Box (OBB) of an actor
  getOBB(actor) {
    const transform = actor.transform;
    const position = vec3(transform[0][3], transform[1][3], transform[2][3]);
    const orientation = [
      vec3(transform[0][0], transform[1][0], transform[2][0]),
      vec3(transform[0][1], transform[1][1], transform[2][1]),
      vec3(transform[0][2], transform[1][2], transform[2][2])
    ];
    const size = actor.mesh.bounding_box || vec3(1, 1, 1); // Ensure size is defined
    return { position, orientation, size };
  }

  // Function to check if two OBBs are colliding
  areOBBsColliding(obb1, obb2) {
    const getSeparatingAxes = (obb1, obb2) => {
      const axes = [
        obb1.orientation[0],
        obb1.orientation[1],
        obb1.orientation[2],
        obb2.orientation[0],
        obb2.orientation[1],
        obb2.orientation[2],
      ];

      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          axes.push(obb1.orientation[i].cross(obb2.orientation[j]).normalized());
        }
      }

      return axes;
    }

    const axes = getSeparatingAxes(obb1, obb2);

    for (let axis of axes) {
      if (!this.overlapOnAxis(obb1, obb2, axis)) {
        return false;
      }
    }

    return true;
  }

  // Function to check if two OBBs overlap on a given axis
  overlapOnAxis(obb1, obb2, axis) {
    const project = (obb, axis) => {
      const corners = this.getCorners(obb);
      let min = corners[0].dot(axis);
      let max = min;
      for (let i = 1; i < corners.length; i++) {
        const projection = corners[i].dot(axis);
        if (projection < min) {
          min = projection;
        }
        if (projection > max) {
          max = projection;
        }
      }
      return [min, max];
    }

    const [min1, max1] = project(obb1, axis);
    const [min2, max2] = project(obb2, axis);

    return !(min1 > max2 || min2 > max1);
  }

  // Function to get the corners of an OBB
  getCorners(obb) {
    const corners = [];
    const { position, orientation, size } = obb;
    const directions = [
      vec3(-1, -1, -1), vec3(-1, -1, 1), vec3(-1, 1, -1), vec3(-1, 1, 1),
      vec3(1, -1, -1), vec3(1, -1, 1), vec3(1, 1, -1), vec3(1, 1, 1),
    ];

    for (let direction of directions) {
      let corner = position.copy();
      for (let i = 0; i < 3; i++) {
        corner = corner.plus(orientation[i].times(direction[i] * size[i]));
      }
      corners.push(corner);
    }

    return corners;
  }


  update_lamp_movement(dt) {
    // Handle jumping
    if (this.lamp_is_jumping) {
      this.lamp_jump_velocity += this.gravity * dt;
      this.lamp_y_position += this.lamp_jump_velocity * dt;

      if (this.lamp_y_position <= this.original_lamp_y) {
        this.lamp_y_position = this.original_lamp_y;
        this.lamp_is_jumping = false;
        this.lamp_jump_velocity = 0;

        if (this.always_jumping) {
          this.lamp_jump_velocity = this.jump_strength;
          this.lamp_is_jumping = true;
        }
      }

      // Apply the rotation even when jumping
      const current_rotation = Math.atan2(this.lamp.transform[0][2], this.lamp.transform[2][2]);
      const lamp_rotation = Matrix4.makeRotationY(current_rotation);
      this.lamp.transform = Matrix4.makeTranslation(this.lamp.transform[0][3], this.lamp_y_position, this.lamp.transform[2][3]).times(lamp_rotation);
    }

    // Handle movement
    if (this.third_person_view && !this.game_over) {
      const movement_speed = this.lamp_speed * dt;
      const forward = vec3(
        Math.sin(this.camera_rotation_y),
        0,
        Math.cos(this.camera_rotation_y)
      ).normalized();
      const right = vec3(
        Math.cos(this.camera_rotation_y),
        0,
        -Math.sin(this.camera_rotation_y)
      ).normalized();

      // console.log(forward);
      // console.log(right);



      let movement_direction = vec3(0, 0, 0);

      if (this.key_states["w"]) {
        movement_direction = movement_direction.minus(forward);
      }
      if (this.key_states["s"]) {
        movement_direction = movement_direction.plus(forward);
      }
      if (this.key_states["a"]) {
        movement_direction = movement_direction.minus(right);
      }
      if (this.key_states["d"]) {
        movement_direction = movement_direction.plus(right);
      }



      let mvmt_trans = Mat4.identity();
      if (movement_direction.norm() !== 0) {
        movement_direction = movement_direction.normalized().times(movement_speed);
        mvmt_trans = mvmt_trans.times(Matrix4.makeTranslation(movement_direction[0], movement_direction[1], movement_direction[2]));

        // Calculate the rotation angle based on the movement direction
        const target_rotation = Math.atan2(movement_direction[0], movement_direction[2]);

        // Calculate the rotation step based on the desired speed
        const rotation_speed = 0.8; // Adjust this value to control the rotation speed
        const rotation_step = rotation_speed * dt;

        // Interpolate the current rotation angle towards the target rotation angle
        const current_rotation = Math.atan2(this.lamp.transform[0][2], this.lamp.transform[2][2]);
        let rotation_diff = target_rotation - current_rotation;

        // Ensure the rotation difference is in the range [-π, π]
        if (rotation_diff > Math.PI) {
          rotation_diff -= 2 * Math.PI;
        } else if (rotation_diff < -Math.PI) {
          rotation_diff += 2 * Math.PI;
        }

        const new_rotation = current_rotation + Math.sign(rotation_diff) * Math.min(Math.abs(rotation_diff), rotation_step);

        // Create a rotation matrix using Mat4.rotation()
        const lamp_rotation = Matrix4.makeRotationY(new_rotation);
        this.lamp.transform = this.lamp.transform.times(Mat4.inverse(Mat4.rotation(current_rotation, 0, 1, 0))).times(lamp_rotation);
      }

      if (this.key_states[" "]) {
        if (!this.lamp_is_jumping) {
          this.lamp_jump_velocity = this.jump_strength; // Initial jump velocity
          this.lamp_is_jumping = true;
        }
      }

      this.lamp.transform = mvmt_trans.times(this.lamp.transform);
      // this.original_lamp_y = this.lamp.transform[1][3]; // Add this line if want the lamp to jump infinitely high

      // this.check_collisions()
      // Collision detection
      const lampOBB = this.getOBB(this.lamp);
      for (let i = this.actors.length - 1; i >= 0; i--) {
        const actor = this.actors[i];
        if (actor !== this.lamp && actor.active) {
          const actorOBB = this.getOBB(actor);
          if (this.health > 0 && this.areOBBsColliding(lampOBB, actorOBB)) {
            if (this.lamp_is_jumping && this.lamp_jump_velocity < 0 && !actor.squishing) {
              console.log("Collision detected with", actor);
              actor.squishing = true;
              actor.squish_timer = 10;
              actor.original_height = actor.mesh.bounding_box[1]; // Store the original height of the actor
            
              // Update health and score
              this.health += 40;
              this.updateHealthAndScoreDisplay();
              this.score += 10;
            } else {
              // Prevent XZ movement clipping
              this.preventClipping(lampOBB, actorOBB);
            }
          }
        }
      }
    }
    // Handle squishing animation
    for (let actor of this.actors) {
      if (actor.squishing) {
        const total_squish_time = 10;
        actor.squish_timer -= dt;
    
        const squish_factor = Math.max(actor.squish_timer / total_squish_time, 0.05); // Scale down y-axis
        const translate_y = (1 - squish_factor) * actor.original_height;
    
        actor.transform = Mat4.translation(actor.transform[0][3], actor.transform[1][3] - translate_y, actor.transform[2][3])
            .times(Mat4.scale(1, squish_factor, 1));
    
        if (actor.squish_timer <= 0) {
          actor.active = false; // Remove the actor after the squishing animation
        }
      }
    }
    // Update falling letters
    for (let i = this.falling_letters.length - 1; i >= 0; i--) {
      const letter = this.falling_letters[i];
      letter.transform = letter.transform.times(Mat4.translation(0, -1 * dt, 0));
      const letterOBB = this.getOBB(letter);
      const groundOBB = this.getOBB(this.ground);

      if (this.areOBBsColliding(letterOBB, groundOBB)) {
        if (letter.mesh.filename === "./assets/pixar_i.obj") {
          letter.transform[1][3] = -1.5; // Set y-coordinate to -1.5 for the letter "I"
        } else {
          letter.transform[1][3] = -1; // Set y-coordinate to -1 for other letters
        }
        this.falling_letters.splice(i, 1);
      }
    }

  }
  decreaseHealth() {
    if (this.game_started && this.health > 0 && !this.demo_mode) {
      const currentTime = performance.now();
      const elapsedTime = this.startTime ? (currentTime - this.startTime) / 1000 : 0;
  
      // Calculate the health decrease rate based on elapsed time
      const healthDecreaseRate = 1 + Math.floor(elapsedTime / 10);
  
      this.health -= healthDecreaseRate;
      this.updateHealthAndScoreDisplay();
      if (this.health <= 0) {
        this.game_over = true;
        this.displayLoseMessage();
      }
    }
  }
  updateHealthAndScoreDisplay() {
    if(this.demo_mode) return;
    const healthAndScoreElement = document.getElementById('healthAndScore');
    if (healthAndScoreElement) {
      const currentTime = performance.now();
      const elapsedTime = this.startTime ? (currentTime - this.startTime) / 1000 : 0;
      const formattedTime = elapsedTime.toFixed(1);
  
      healthAndScoreElement.textContent = `Health: ${this.health} | Score: ${this.score} | Time: ${formattedTime}s`;
    }
  }
  displayLoseMessage() {
    const loseElement = document.createElement('div');
    loseElement.id = 'loseMessage';
    loseElement.style.position = 'absolute';
    loseElement.style.top = '50%';
    loseElement.style.left = '50%';
    loseElement.style.transform = 'translate(-50%, -50%)';
    loseElement.style.textAlign = 'center';
    loseElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    loseElement.style.padding = '20px';
    loseElement.style.borderRadius = '10px';
    loseElement.style.zIndex = '9999';

    const loseTextElement = document.createElement('h1');
    loseTextElement.textContent = 'Game Over';
    loseTextElement.style.color = 'white';
    loseTextElement.style.marginBottom = '20px';

    const playAgainButtonElement = document.createElement('button');
    playAgainButtonElement.textContent = 'Play Again';
    playAgainButtonElement.style.padding = '10px 20px';
    playAgainButtonElement.style.fontSize = '18px';
    playAgainButtonElement.style.backgroundColor = '#4CAF50';
    playAgainButtonElement.style.color = 'white';
    playAgainButtonElement.style.border = 'none';
    playAgainButtonElement.style.borderRadius = '5px';
    playAgainButtonElement.style.cursor = 'pointer';
    playAgainButtonElement.addEventListener('click', () => {
    this.resetGame();
  });

  loseElement.appendChild(loseTextElement);
  loseElement.appendChild(playAgainButtonElement);
  document.body.appendChild(loseElement);
  this.unlock_pointer();
  clearInterval(this.spawn_interval);
  }

  resetGame() {
    // Reset game state

    this.game_started = false;
    this.game_over = false;
    this.health = 100;
    this.score = 0;
    this.startTime = null;
    clearInterval(this.spawn_interval);
    // Clear falling letters
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i];
      if (actor !== this.lamp && actor !== this.ground) {
        this.actors.splice(i, 1);
      }
    }
    this.falling_letters = [];
  
    // Reset lamp position
    this.lamp.transform = Mat4.translation(-7.5, 0, 14.5);
    this.original_lamp_y = 0;
    this.lamp_y_position = 0;
    this.lamp_is_jumping = true;

    this.always_jumping = true; // change to true for intro view
    this.lamp_jump_velocity = 0;
    this.letter_p = new Actor();
    this.letter_p.mesh = this.meshes[0];
    this.letter_p.material = this.letter_material;
    this.letter_p.transform = Mat4.translation(-10, -1, 30);
    this.letter_p.mesh.bounding_box = vec3(1, 1, 1); // Set an appropriate bounding box for the letter P

    this.letter_i = new Actor();
    this.letter_i.mesh = this.meshes[1];
    this.letter_i.material = this.letter_material;
    this.letter_i.transform = Mat4.translation(-10, -1.5, 15); // idk wtf happened with the import honestly
    this.letter_i.mesh.bounding_box = vec3(1, 1, 1); // Set an appropriate bounding box for the letter I

    this.letter_x = new Actor();
    this.letter_x.mesh = this.meshes[2];
    this.letter_x.material = this.letter_material;
    this.letter_x.transform = Mat4.translation(-10, -1, 0);
    this.letter_x.mesh.bounding_box = vec3(1, 1, 1); // Set an appropriate bounding box for the letter X

    this.letter_a = new Actor();
    this.letter_a.mesh = this.meshes[3];
    this.letter_a.material = this.letter_material;
    this.letter_a.transform = Mat4.translation(-10, -1, -15);
    this.letter_a.mesh.bounding_box = vec3(1, 1, 1); // Set an appropriate bounding box for the letter A

    this.letter_r = new Actor();
    this.letter_r.mesh = this.meshes[4];
    this.letter_r.material = this.letter_material;
    this.letter_r.transform = Mat4.translation(-10, -1, -30);
    this.letter_r.mesh.bounding_box = vec3(1, 1, 1); // Set an appropriate bounding box for the letter R

    this.actors = [this.lamp, this.ground, this.letter_p, this.letter_i, this.letter_x, this.letter_a, this.letter_r];
  
    // Remove the lose message
    const loseElement = document.getElementById('loseMessage');
    if (loseElement) {
      loseElement.remove();
    }
  
    // Update the health and score display
    this.updateHealthAndScoreDisplay();
  
    // Show the start menu
    this.showStartMenu();

    this.intro_view = true;
    this.third_person_view = false;

    this.unlock_pointer();
  }
  request_pointer_lock() {
    if (this.game_started && !this.game_over) {
      this.canvas.requestPointerLock();
    }
  }

  // Function to prevent clipping between the lamp and another actor
  preventClipping(lampOBB, actorOBB) {
    const lampPosition = lampOBB.position;
    const actorPosition = actorOBB.position;
    const lampSize = lampOBB.size;
    const actorSize = actorOBB.size;

    const deltaX = lampPosition[0] - actorPosition[0];
    const deltaZ = lampPosition[2] - actorPosition[2];

    const overlapX = (lampSize[0] + actorSize[0]) / 2 - Math.abs(deltaX);
    const overlapZ = (lampSize[2] + actorSize[2]) / 2 - Math.abs(deltaZ);

    if (overlapX > 0 && overlapZ > 0) {
      if (overlapX < overlapZ) {
        if (deltaX > 0) {
          this.lamp.transform[0][3] = actorPosition[0] + (lampSize[0] + actorSize[0]) / 2;
        } else {
          this.lamp.transform[0][3] = actorPosition[0] - (lampSize[0] + actorSize[0]) / 2;
        }
      } else {
        if (deltaZ > 0) {
          this.lamp.transform[2][3] = actorPosition[2] + (lampSize[2] + actorSize[2]) / 2;
        } else {
          this.lamp.transform[2][3] = actorPosition[2] - (lampSize[2] + actorSize[2]) / 2;
        }
      }
    }
  }


  // Function to spawn a falling letter at a random position above the scene
  spawnFallingLetter() {
    if (!this.game_started || this.game_over) {
      return;
    }
    const randomIndex = Math.floor(Math.random() * 5);

    const currentTime = performance.now();
    const elapsedTime = (currentTime - this.startTime) / 1000; // Convert to seconds

    // Calculate the spawn interval based on the elapsed time
    const baseInterval = 2000; // Base spawn interval in milliseconds
    const minimumInterval = 500; // Minimum spawn interval in milliseconds
    const spawnInterval = Math.max(baseInterval - elapsedTime * 100, minimumInterval);

    // Clear the previous spawn interval
    clearInterval(this.spawn_interval);

    // Set the new spawn interval
    this.spawn_interval = setInterval(this.spawnFallingLetter.bind(this), spawnInterval);

    const letter = new Actor();
    letter.mesh = this.meshes[randomIndex];
    letter.material = this.letter_material;
    const boundingDistance = 100;
    letter.transform = Mat4.translation(Math.random() * boundingDistance - boundingDistance/2, 20, Math.random() * boundingDistance - boundingDistance/2);
    letter.mesh.bounding_box = vec3(1, 1, 1); // Set an appropriate bounding box for the letter

    this.falling_letters.push(letter);
    this.actors.push(letter);
  }


  display(context, program_state) {
    if (!this.renderer) {
      context.set_size([window.innerWidth, window.innerHeight]);
      const gl = context.context;
      this.renderer = new Renderer(gl);
    }
    this.canvas = context.canvas

    this.frametimeElement.textContent = `${program_state.animation_delta_time.toFixed(2)}ms`;

    if (!this.game_started) {
      this.showStartMenu();
      // return;
    }
    if (!context.scratchpad.controls) {
      this.children.push(context.scratchpad.controls = new defs.Movement_Controls());
      // Define the global camera and projection matrices, which are stored in program_state.
      program_state.set_camera(Mat4.translation(5, -10, -30));
    }

    program_state.projection_transform = Mat4.perspective(
      Math.PI / 4, context.width / context.height, 1, 100);

    // *** Lights: *** Values of vector or point lights.
    // Calculate the intensity based on health
    const max_intensity = 7;
    const light_intensity = this.game_started ? Math.min((this.health / 150) ** 3 * max_intensity, max_intensity) : max_intensity; // when health <= 50, light_intensity decreases
    program_state.directional_light = new DirectionalLight(vec3(-1, -1, 1), vec3(1, 1, 1), light_intensity);

    /*
      TODO: GAME LOGIC GOES HERE
    */

    // Update lamp movement
    let dt = program_state.animation_delta_time / 1000; // Delta time in seconds
    dt *= 20; // Speed up the animation
    this.update_lamp_movement(dt);

    // Store the initial camera location for manual controls
    let camera_transform = program_state.camera_inverse;

    // Update camera based on the view mode - third person view of the lamp
    if (this.third_person_view) {
      const lamp_position = this.lamp.transform.times(vec4(0, 0, 0, 1)).to3();
      const ground_level = -2.5; // Adjust this value to match the ground level in your scene
      const max_pitch = Math.PI / 2 - 0.1; // Adjust this value to set the maximum pitch angle

      // Limit the camera's vertical rotation (pitch) to prevent looking exactly up
      this.camera_rotation_x = Math.min(Math.max(this.camera_rotation_x, -max_pitch), max_pitch);

      // Calculate the camera position based on the rotation and camera distance
      let camera_position = lamp_position.plus(
        vec3(
          this.camera_distance * Math.sin(this.camera_rotation_y) * Math.cos(this.camera_rotation_x),
          this.camera_distance * Math.sin(this.camera_rotation_x),
          this.camera_distance * Math.cos(this.camera_rotation_y) * Math.cos(this.camera_rotation_x)
        )
      );
  
      // Ensure the camera's y-position is above the ground level
      camera_position[1] = Math.max(camera_position[1], ground_level);
  
      const target_position = lamp_position;
      const up_vector = vec3(0, 1, 0);
  
      // Check if the camera position and target position are too close
      const distance = camera_position.minus(target_position).norm();
      if (distance < 0.1) {
        // Adjust the camera position slightly to avoid parallel vectors
        const offset = camera_position.minus(target_position).normalized().times(0.1);
        camera_position.add_by(offset);
      }
  
      const camera_transform = Mat4.look_at(camera_position, target_position, up_vector);
  
      program_state.set_camera(camera_transform);
    } else if (this.intro_view) {
      const camera_position = vec3(40, 0, 0);
      const target_position = this.letter_x.transform.times(vec4(0, 0, 0, 1)).to3();
      const up_vector = vec3(0, 1, 0);  // Assuming the up direction is the positive Y-axis
      const camera_transform = Mat4.look_at(camera_position, target_position, up_vector);

      program_state.set_camera(camera_transform);
    }
    else {
      program_state.set_camera(camera_transform);

    }

    program_state.spot_light = new SpotLight(
      this.lamp.transform.times(vec4(0, 1, 0.5, 1)).to3(),
      this.lamp.transform.times(vec4(0, -0.5, 1, 0)).to3(),
      vec3(1, 1, 1),
      10,
      Math.PI / 9,
      Math.PI / 6
    );

    // Handle squishing animation
    for (let actor of this.actors) {
      if (actor.squishing) {
        const total_squish_time = 10;
        const half_time = 7;
        actor.squish_timer -= dt;

        if (actor.squish_timer > half_time) {
          // First half: Squishing
          const squish_factor = Math.max((actor.squish_timer - half_time) / half_time, 0.05); // Scale down y-axis
          actor.transform = Mat4.translation(actor.transform[0][3], actor.transform[1][3], actor.transform[2][3])
              .times(Mat4.scale(1, squish_factor, 1));
        } else {
          // Second half: Translation
          const translate_factor = Math.max(actor.squish_timer / half_time, 0); // Translate down
          const translate_y = (1 - translate_factor) * actor.original_height;
          actor.transform = Mat4.translation(actor.transform[0][3], actor.transform[1][3] - translate_y, actor.transform[2][3])
              .times(Mat4.scale(1, 0.05, 1)); // Ensure it stays squished
        }

        if (actor.squish_timer <= 0) {
          actor.active = false; // Remove the actor after the squishing animation
        }
      }
    }

    this.renderer.submit(context, program_state, this.actors.filter(actor => actor.active));
  }
}
