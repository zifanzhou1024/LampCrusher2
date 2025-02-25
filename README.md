# LampCrusher2 - Three.js Project

This project is a three.js application that loads a lamp model along with several letter models using the OBJ and MTL loaders. It supports basic movement (WASD), jumping, and toggling between first-person and third-person views with the "v" key. The project demonstrates how to work with ES Modules, asset loading, and simple physics within a 3D scene.

---

## Project Structure

```
LampCrusher2/
├── assets/
│   ├── lamp.obj
│   ├── lamp.mtl
│   ├── pixar_p.obj
│   ├── pixar_p.mtl
│   ├── pixar_i.obj
│   ├── pixar_i.mtl
│   ├── pixar_x.obj
│   ├── pixar_x.mtl
│   ├── pixar_a.obj
│   ├── pixar_a.mtl
│   ├── pixar_r.obj
│   └── pixar_r.mtl
├── index.html
├── lamp_crusher_two.js
├── package.json
└── node_modules/
```

- **assets/**: Contains all the model and material files required by the project.
- **index.html**: The main HTML file that loads the JavaScript module.
- **lamp_crusher_two.js**: The main JavaScript file where the three.js scene, camera, renderer, controls, and animations are set up.
- **package.json**: Holds your project dependencies and scripts.
- **node_modules/**: Contains installed npm packages.

---

## Prerequisites

- **Node.js**: Ensure you have Node.js installed on your computer. You can download it from [nodejs.org](https://nodejs.org/).

---

## Installation

1. **Clone or Download the Project**

   Clone the repository or download the project files into your preferred directory.

2. **Initialize the Project**

   Open a terminal in the project directory.

3. **Install Dependencies**

   Install three.js and Vite (a build tool) by running:

   ```bash
   npm install --save three
   npm install --save-dev vite
   ```

   This will create a `node_modules` folder and update your `package.json` file with the necessary dependencies.

4. **(Optional) Add a Start Script**

   You can add a script to your `package.json` to easily start the development server. Open your `package.json` file and add the following under `"scripts"`:

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
   npx vite
   ```

   or if you added the start script:

   ```bash
   npm run dev
   ```

2. **Open the Application**

   Once Vite starts, it will output a URL (e.g., `http://localhost:5173`). Open that URL in your web browser to see your project in action.

> **Note:** Because the project uses ES Modules and dynamic asset loading, it must be served from a local server. Opening `index.html` directly in the browser (via double-click) may lead to issues.

### Production Mode

When you're ready to deploy your project, build it using:

```bash
npx vite build
```

or:

```bash
npm run build
```

This command will compile and optimize your project files and output them into a `dist/` folder. You can then host the contents of this folder on your web server.

### Alternative: Running with a Static Server

If you prefer not to use Vite, you can use a static server to serve your files. For example, install the `serve` package globally or use `npx`:

```bash
npx serve .
```

Then, open the provided URL (e.g., `http://localhost:3000`) in your browser.

---

## Usage

- **Movement Controls:**
    - **W/A/S/D:** Move the lamp model around the scene.
    - **Space Bar:** Make the lamp jump.
    - **Mouse Movement:** Controls the camera rotation. Click on the rendered canvas to lock the pointer for full mouse control.

- **View Mode Toggle:**
    - **V Key:** Toggle between first-person and third-person views.
        - **First-Person View:** Camera attaches to the lamp.
        - **Third-Person View:** Camera orbits around the lamp.

- **Asset Loading:**  
  The project loads a lamp model and several letter models from the `assets/` folder using the OBJLoader and MTLLoader from three.js addons.

---

## Additional Resources

- **three.js Documentation:** [threejs.org/docs](https://threejs.org/docs/)
- **Vite Documentation:** [vitejs.dev/guide](https://vitejs.dev/guide/)
- **Node.js:** [nodejs.org](https://nodejs.org/)

