Below is an updated README.md that reflects the major changes in the project:

---

# LampCrusher2 – Advanced WebGL Game

LampCrusher2 is an interactive WebGL game that combines Three.js with a custom GPU rendering pipeline and physics engine. Inspired by classic animation, you control a lamp that must crush falling letters. The project features advanced rendering techniques including physically based lighting, shadow mapping, temporal anti-aliasing (TAA), and dynamic post‑processing effects. In addition, a custom physics engine handles realistic movement and collision responses, while a flexible asset loading system supports both glTF and legacy OBJ/MTL models.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Project](#running-the-project)
    - [Development Mode](#development-mode)
    - [Production Mode](#production-mode)
    - [Static Server Alternative](#static-server-alternative)
- [Usage](#usage)
- [Additional Resources](#additional-resources)

---

## Project Overview

LampCrusher2 has evolved from a basic Three.js application into a full-fledged game that features:

- **Advanced Rendering:** A custom GPU pipeline with multiple render passes, physically based rendering (PBR), shadow mapping, and temporal anti-aliasing for high-quality visuals.
- **Custom Physics Engine:** Simulates gravity, collision detection using oriented bounding boxes (OBBs), and spring-based soft-body responses when the lamp crushes letters.
- **Flexible Asset Loading:** Supports modern glTF models (via GLTFLoader) alongside legacy OBJ/MTL assets.
- **Dynamic User Interface:** Includes start menus, mode selection, an in-game HUD for health, score, and time, and animated score popups.
- **Multiple Game Modes:** Offers various difficulty levels and a demo mode for testing.

---

## Project Structure

The project is organized as follows:

```
LampCrusher2/
├── LICENSE
├── README.md
├── dist/                   # Production build output folder
├── public/                 # Static assets (e.g., glTF models, textures)
├── node_modules/           # Installed npm packages
├── assets/                 # (Legacy) assets for OBJ/MTL models
├── gpu.js                  # GPU modules for mesh and shader management
├── renderer.js             # Main rendering pipeline and scene management
├── physics_engine.js       # Custom physics engine implementation
├── shaders.js              # GLSL shader source definitions
├── ui.js                   # User interface code (menus, HUD, popups)
├── lamp_crusher_two.js     # Main game logic and scene setup
├── package.json            # Project dependencies and scripts
├── vite.config.js          # Vite configuration for development/build
└── (other files such as main.js, ui.css, etc.)
```

*Note:* The project has undergone significant changes—from a simple Three.js demo to an advanced WebGL game with custom physics, rendering, and UI modules.

---

## Prerequisites

- **Node.js:** Install Node.js (v12 or above is recommended) from [nodejs.org](https://nodejs.org/).
- **npm:** Node Package Manager (bundled with Node.js).

---

## Installation

1. **Clone the Repository**

   ```bash
   git clone https://github.com/your_username/LampCrusher2.git
   cd LampCrusher2
   ```

2. **Install Dependencies**

   Run the following command to install the required packages:

   ```bash
   npm install
   ```

3. **(Optional) Update Start Scripts**

   Ensure your `package.json` includes:

   ```json
   "scripts": {
     "dev": "vite",
     "build": "vite build"
   }
   ```

---

## Running the Project

### Development Mode

1. **Start the Local Server**

   In your terminal, run:

   ```bash
   npm run dev
   ```
   or
   ```bash
   npx vite
   ```

2. **Open the Application**

   Once Vite starts, it will output a URL (e.g., `http://localhost:5173`). Open this URL in your browser.

   > **Note:** The project uses ES Modules and dynamic asset loading, so it must be served from a local server rather than opened directly from the filesystem.

### Production Mode

To compile and optimize the project for deployment:

```bash
npm run build
```

The output files will be placed in the `dist/` folder. You can host these files on your preferred web server.

### Static Server Alternative

If you prefer not to use Vite, you can serve the project using a static server:

```bash
npx serve dist
```

Then open the provided URL (e.g., `http://localhost:3000`) in your browser.

---

## Usage

- **Movement Controls:**
    - **W/A/S/D:** Move the lamp around the scene.
    - **Space Bar:** Make the lamp jump.
    - **Mouse Movement:** Controls camera rotation. Click the canvas to lock the pointer.

- **View Mode Toggle:**
    - **V Key:** Toggle between first-person view (camera attached to the lamp) and third-person view (camera orbits the lamp).

- **Game Modes:**
    - **Start Menu & Mode Selection:** Upon launch, select from multiple game modes (Easy, Normal, Hard, Harder, or Demo).
    - **Demo Mode:** Press `P` to pause health decrease for testing purposes.

- **Asset Loading:**
    - The project now supports modern glTF models (loaded via GLTFLoader) along with legacy OBJ/MTL formats, offering greater flexibility in asset management.

- **Special Effects:**
    - Enjoy advanced visual effects such as PBR lighting, dynamic shadow mapping, TAA for smoother visuals, and custom smoke effects triggered during gameplay events.

---

## Additional Resources

- **Three.js Documentation:** [threejs.org/docs](https://threejs.org/docs/)
- **Vite Documentation:** [vitejs.dev/guide](https://vitejs.dev/guide/)
- **Node.js:** [nodejs.org](https://nodejs.org/)
- **WebGL Guides:** See MDN Web Docs for comprehensive WebGL resources.

---
