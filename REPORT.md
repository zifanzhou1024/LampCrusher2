# Lamp Crusher 2 – Technical Project Report

**Authors:**
- Zifan Zhou
- Jiaxi Liu
- Brandon Shihabi
- Guanhuaji

**Date:** March 2025

---

## Table of Contents

1. [Introduction](#introduction)
2. [Project Objectives](#project-objectives)
3. [Architecture & Design](#architecture--design)
    - [Rendering Engine](#rendering-engine)
    - [Animation Skinning](#animation-skinning)
    - [Physics Engine](#physics-engine)
    - [Asset Loading and Shaders](#asset-loading-and-shaders)
    - [User Interface](#user-interface)
4. [Implementation Details](#implementation-details)
    - [Core Technologies](#core-technologies)
    - [Modular Structure](#modular-structure)
    - [Physics and Collision Handling](#physics-and-collision-handling)
    - [Special Effects](#special-effects)
5. [Development Environment](#development-environment)
6. [Challenges and Future Improvements](#challenges-and-future-improvements)
7. [Conclusion](#conclusion)

---

## Introduction

Lamp Crusher 2 is an interactive WebGL game inspired by the iconic Pixar lamp. In this project, players control a lamp that crushes falling letters in a dynamic, stylized 3D environment. The gameplay is fast-paced, with a focus on physics-driven animations, responsive controls, and visually engaging effects. The project combines modern web-based 3D rendering (via Three.js and custom WebGL code) with physically-based rendering and a custom physics engine to simulate realistic movement, and collisions.

---

## Project Objectives

- **Gameplay:** Create an engaging game where the player controls a lamp to crush falling letters while managing health and scoring points.
- **Visuals:** Develop a stylized 3D environment with high-quality lighting, shadows, and post-processing effects that echo classic animation aesthetics.
- **Physics:** Implement a custom physics engine that handles gravity, collision detection, soft-body interactions, and response between dynamic objects.
- **Animation:** Use joint-based skinning and procedural animation techniques to bring the lamp and letters to life.
- **User Experience:** Design an intuitive user interface (UI) that includes mode selection, a start menu, in-game HUD, and dynamic score popups.
- **Performance:** Leverage modern web technologies and optimization strategies (such as Temporal Anti-Aliasing and multiple render passes) to ensure smooth gameplay.

---

## Architecture & Design

### Rendering Engine

The rendering system is built on top of WebGL with additional help from Three.js. Key components include:

- **PBR Materials:** Materials use physically based properties of roughness, metalness, and diffuse to accurately represent their values. 
   - **Shaders:**
     - The physically‑based material shader (`PS_PBRMaterial`) is defined in **`shaders.js`** (roughly lines **50–100**). 
- **Deferred Rendering Setup:** Separate GBuffers are used to render PBR material data, velocity, and other parameters.
   - **GBuffer Creation:**
     - Initialization of the GBuffers (diffuse/metallic, normals/roughness, velocity, depth) is done in **`renderer.js`** (inside the `init_gbuffer` function, roughly lines **1000–1180**).
     - The PBR lighting buffer setup is implemented in **`renderer.js`** (in `init_pbr_buffer`, roughly lines **1180–1210**).
   - **Material Rendering Pass:**
     - Rendering to GBuffers is done in **`renderer.js`** (in `render_handler_gbuffer`, roughly lines **1300-1340**).
     - The shader used is in **`shaders.js`** (`PS_PBRMaterial`, roughly lines **96-137**).
- **Shadow Mapping:** Directional shadows are computed using an orthographic projection.
  - **Shadow Map Initialization:**
    - The creation of the directional shadow map (using an orthographic projection) is implemented in **`renderer.js`** in the `init_shadow_maps` function (around lines **1280–1300**).
  - **Shadow Rendering Pass:**
    - The directional shadow pass is handled in **`renderer.js`** within the `render_handler_directional_shadow` function (roughly lines **1340–1380**).
- **Lighting:** Lighting is computed by rendering a fullscreen quad and using the cook-torrance BRDF for specular with lambert diffuse. Shadows are sampled and filtered using PCF filtering.
  - The lighting pass—using a fullscreen quad, cook‑torrance BRDF, and PCF for shadow filtering—is implemented in **`renderer.js`** (in the `render_handler_lighting` function, around lines **1420–1460**).
  - The shader used is in **`shaders.js`** (`PS_StandardBrdf`, roughly lines **166-424**).
- **Tone Mapping:** Tone mapping is applied before TAA with an sRGB 2.2 gamma compression transfer function and an ACES approximation. It is applied before TAA to reduce variance.
  - The tone mapping shader (`PS_Tonemapping`) is defined in **`shaders.js`** (approximately lines **530–560**).
- **Temporal Anti-Aliasing:** TAA is applied using the velocity, previous velocity, current jittered lighting, depth, and an accumulation buffer smooth aliasing artifacts. We use velocity disocclusion and color clamping to reduce ghosting and disocclusion artifacts.
  - The TAA render pass is set up in **`renderer.js`** (in the `render_handler_taa` function, roughly lines **650–700**).
  - The corresponding TAA shader (`PS_TAA`) is defined in **`shaders.js`** (around lines **430–530**).

### Animation Skinning

Animation is implemented using bone matrices with inverse bind pose being applied. The steps are:

- **Load GLTF Model:** Models with their skinned vertices, bones, and animation clips are loaded by the load function into custom skinned model classes
  - **GLTF Model Loading:**
    - The function `load_gltf_model` that loads GLTF files and processes skinned meshes is implemented in **`renderer.js`** (roughly lines **625–800**).
  - **Skeleton and Skinning Data:**
    - The classes for handling skinned models (including `SkinnedModel` and `Skeleton`) in **`renderer.js`**.
- **Calculate Inverse Bind Pose:** The inverse bind pose matrices are calculated using forward kinematics and applying the matrix inverse on the transform. These are stored permanently.
  -   - Within the **`Skeleton`** class in **`renderer.js`** (roughly lines **260–300**) the inverse bind pose is calculated and stored.
- **Interpolate Bone Matrices:** Gameplay code can tell a skinned model which animation and time t (0-1 normalized) is used and the animation clip with position/rotation data is interpolated using lerp and slerp. These are formed into bone matrices using forward kinematics.
   - The class **`AnimClip`** (and its helper **`AnimTrack`**) in **`renderer.js`** provides the function `get_bone_transform(bone_idx, t)`. This interpolation logic is implemented roughly around **lines 200–235**.
- **Inverse Bind Pose:** The inverse bind pose is applied to all of the bone matrices before handing off to the shader. This makes sure vertices are not displaced "twice".
  - In the **`Skeleton`** class’s `update_anim` method in **`renderer.js`**, after computing each bone’s world transform (using the interpolated data), the inverse bind pose is multiplied into the bone matrix. This ensures that the vertex positions are not displaced twice when skinning is applied. This application occurs roughly around **lines 317–330**.
- **Custom Skinning Vertex Shader:** VS_ModelSkinned uses the bone matrices to transform vertices of every model with up to 2 bones of influence. This then goes through the normal deferred rendering pipeline.
   - The shader `VS_ModelSkinned` that transforms vertices with up to two bone influences is defined in **`shaders.js`** (roughly lines **43–94**)

### Physics Engine

The custom physics engine, implemented in `physics_engine.js`, features:

- **Fixed Timestep Integration:** Instead of using delta time, a fixed update loop runs based on how much time has passed in order to "catch" up to the frame that will land on glass.
  - The physics update loop that uses a fixed timestep (ensuring stable integration for motion and collisions) is implemented in **`physics_engine.js`** (roughly lines **160-170**, **260-280**,**340-370**).
- **Collision Detection:** Oriented bounding boxes (OBBs) are computed and used to detect and resolve collisions between the lamp and falling letters.
  - **OBB Calculation:**
    - Functions such as `getOBB`, `computeOBBCorners`, and `obbIntersect`—used to compute oriented bounding boxes and test collisions—are implemented in **`physics_engine.js`** (roughly in **1-150 lines**).
  - **Collision Resolution & Spring Forces:**
    - The code handling soft‑body responses (using spring‑based forces for realistic letter squashing when the lamp lands) is in **`physics_engine.js`** (lines **188–335**).
- **Spring-Based Responses:** Implements soft-body physics for realistic letter squashing and bounce responses when the lamp stomps on them.
   - The code computes spring forces based on the difference between the letter's rest height and its current compressed state and applies damping through a spring damping coefficient. This spring‑based collision response logic is integrated into the collision resolution loop, roughly around **lines 150–350**.
- **Gravity and Friction:** Gravity is applied to all actors, and friction is simulated when objects interact with the ground.
   - When actors interact with the ground, friction is simulated by computing a tangential damping force from the actor's horizontal velocity and applying a friction coefficient. This implementation is also found in **`physics_engine.js`** (roughly lines **150-190**).

### Particle System
   - **Particle Creation and Initialization:**
      - When a letter is crushed, a burst of particles (e.g., debris or smoke fragments) is generated by calling the function `spawnCrushParticles`.
      - This function is implemented in **`lamp_crusher_two.js`** (roughly lines **40-80**) where particles are created with randomized positions, velocities, and lifetimes.
   - **Particle Lifecycle and Update:**
      - The particle update logic—which advances each particle’s position based on its velocity and decrements its lifetime—is integrated into the main game loop in **`lamp_crusher_two.js`** (roughly lines **40-60**, **860-870**).
      - Expired particles are removed from the scene during these update passes.
   - **Integration with Rendering:**
      - The particles are rendered using a basic mesh and associated shader (sharing aspects of the deferred rendering pipeline) as set up in **`renderer.js`**.

### User Interface

The UI is implemented in `ui.js` and comprises:

- **Start Menu and Mode Selection:** Initial menus allow the player to choose game modes (e.g., Easy, Normal, Hard, Harder, Demo).
- **HUD:** Displays real-time information on health, score, and elapsed time.
- **Score Popups:** Brief, animated popups inform the player of score increments when letters are crushed.
- **Game Over/Win Screens:** Overlay screens are shown when the game ends, with options to restart.

---

## Implementation Details

### Core Technologies

- **WebGL & Three.js:** Core graphics rendering is achieved using a combination of low-level WebGL commands (for custom pipelines) and Three.js (for model loading and helper math functions).
- **ES Modules:** The project is structured using ES modules to separate concerns (GPU, rendering, physics, UI, shaders).
- **Vite:** Used as the development server and build tool for rapid iteration.

### Modular Structure

The project is divided into several key files:

- **`gpu.js`:** Contains classes for GPU mesh management and shader program setup.
- **`renderer.js`:** Implements the main rendering pipeline, including G-buffer creation, shadow mapping, and post-processing.
- **`physics_engine.js`:** Manages game physics, integration, and collision response.
- **`ui.js`:** Handles all user interface elements, including menus and HUD.
- **`shaders.js`:** Defines the GLSL shader source code used in various render passes.

### Physics and Collision Handling

- **Verlet Integration:** Actor positions are updated using a form of velocity verlet integration to simulate motion.
  - This integration logic is implemented in **`physics_engine.js`** (roughly lines **340–360**).
- **OBB Collision Resolution:** The physics engine computes oriented bounding boxes for actors and resolves collisions based on minimum translation vectors (MTVs).
  -   - The OBB computation functions (e.g. `getOBB`, `computeOBBCorners`, `obbIntersect`) are found in **`physics_engine.js`** (roughly lines **1–150**), while the collision resolution using MTVs is handled in the later sections (roughly lines **150–350**).
- **Spring Forces:** Soft-body responses simulate letter deformation when the lamp lands on them, awarding points and adjusting health.
  - This spring force implementation is also part of the collision resolution logic in **`physics_engine.js`** (roughly lines **180–330**).





---

## Development Environment

- **Node.js & npm:** Used to manage dependencies and scripts.
- **Vite:** Provides a fast development server and build optimization.
- **Module Bundling:** The project’s modular structure is supported by ES modules, making it easier to maintain and scale.

To run the project locally:
1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Start Development Server:**
   ```bash
   npm run dev
   ```
3. **Build for Production:**
   ```bash
   npm run build
   npm run serve
   ```

---

## Challenges and Future Improvements

### Challenges

- **Performance Optimization:** Balancing high-quality post-processing (TAA, PBR lighting) with real-time performance on the web.
- **Physics Accuracy:** Implementing stable and responsive collision detection and resolution with soft-body dynamics.
- **Shader Complexity:** Developing and debugging advanced shaders (such as TAA or skinning) required careful tuning and validation.

### Future Improvements

- **Enhanced Particle Systems:** Improve the particle system for more dynamic smoke and debris effects.
- **Additional Game Mechanics:** Add more interactive elements or power-ups to diversify gameplay.
- **Expanded Model Animations:** Incorporate more detailed skeletal animations for the lamp and letters.
- **Cross-Platform Testing:** Optimize for performance on a wider range of devices and browsers.

---

## Resources

- Lamp model: https://sketchfab.com/3d-models/pixar-lamp-f97d17ac89a14ff68c3e488c69340b44 (NOTE: We rigged and animated the model ourselves, however the unskinned model is from here)

---

