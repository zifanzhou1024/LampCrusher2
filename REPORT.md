---

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

Lamp Crusher 2 is an interactive WebGL game inspired by the iconic Pixar lamp. In this project, players control a lamp that crushes falling letters in a dynamic, stylized 3D environment. The gameplay is fast-paced, with a focus on physics-driven animations, responsive controls, and visually engaging effects. The project combines modern web-based 3D rendering (via Three.js and custom WebGL code) with physically-based rendering and a custom physics engine to simulate realistic movement, collisions, and special effects such as smoke.

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
- **Deferred Rendering Setup:** Separate GBuffers are used to render PBR material data, velocity, and other parameters.
- **Shadow Mapping:** Directional shadows are computed using an orthographic projection.
- **Lighting:** Lighting is computed by rendering a fullscreen quad and using the cook-torrance BRDF for specular with lambert diffuse. Shadows are sampled and filtered using PCF filtering.
- **Tone Mapping:** Tone mapping is applied before TAA with an sRGB 2.2 gamma compression transfer function and an ACES approximation. It is applied before TAA to reduce variance.
- **Temporal Anti-Aliasing:** TAA is applied using the velocity, previous velocity, current jittered lighting, depth, and an accumulation buffer smooth aliasing artifacts. We use velocity disocclusion and color clamping to reduce ghosting and disocclusion artifacts.

### Animation Skinning

Animation is implemented using bone matrices with inverse bind pose being applied. The steps are:

- **Load GLTF Model:** Models with their skinned vertices, bones, and animation clips are loaded by the load function into custom skinned model classes
- **Calculate Inverse Bind Pose:** The inverse bind pose matrices are calculated using forward kinematics and applying the matrix inverse on the transform. These are stored permanently.
- **Interpolate Bone Matrices:** Gameplay code can tell a skinned model which animation and time t (0-1 normalized) is used and the animation clip with position/rotation data is interpolated using lerp and slerp. These are formed into bone matrices using forward kinematics.
- **Inverse Bind Pose:** The inverse bind pose is applied to all of the bone matrices before handing off to the shader. This makes sure vertices are not displaced "twice".
- **Custom Skinning Vertex Shader:** VS_ModelSkinned uses the bone matrices to transform vertices of every model with up to 2 bones of influence. This then goes through the normal deferred rendering pipeline.

### Physics Engine

The custom physics engine, implemented in `physics_engine.js`, features:

- **Fixed Timestep Integration:** Instead of using delta time, a fixed update loop runs based on how much time has passed in order to "catch" up to the frame that will land on glass.
- **Collision Detection:** Oriented bounding boxes (OBBs) are computed and used to detect and resolve collisions between the lamp and falling letters.
- **Spring-Based Responses:** Implements soft-body physics for realistic letter squashing and bounce responses when the lamp stomps on them.
- **Gravity and Friction:** Gravity is applied to all actors, and friction is simulated when objects interact with the ground.

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
- **OBB Collision Resolution:** The physics engine computes oriented bounding boxes for actors and resolves collisions based on minimum translation vectors (MTVs).
- **Spring Forces:** Soft-body responses simulate letter deformation when the lamp lands on them, awarding points and adjusting health.

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
   ```

---

## Challenges and Future Improvements

### Challenges

- **Performance Optimization:** Balancing high-quality post-processing (TAA, PBR lighting) with real-time performance on the web.
- **Physics Accuracy:** Implementing stable and responsive collision detection and resolution with soft-body dynamics.
- **Shader Complexity:** Developing and debugging advanced shaders (such as the smoke effect and TAA) required careful tuning and validation.

### Future Improvements

- **Enhanced Particle Systems:** Improve the particle system for more dynamic smoke and debris effects.
- **Additional Game Mechanics:** Add more interactive elements or power-ups to diversify gameplay.
- **Expanded Model Animations:** Incorporate more detailed skeletal animations for the lamp and letters.
- **Cross-Platform Testing:** Optimize for performance on a wider range of devices and browsers.

---

## Conclusion

Lamp Crusher 2 represents a comprehensive project that integrates modern web-based 3D rendering techniques with custom physics and shader programming. The project successfully combines artistic inspiration with technical innovation to deliver an engaging and visually appealing game experience. The modular design and use of advanced rendering pipelines (including PBR, shadow mapping, and TAA) lay a strong foundation for future enhancements and scalability.

---

