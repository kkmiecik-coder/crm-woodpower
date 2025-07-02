class WoodViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.currentMesh = null;

        // KONFIGURACJA KOLORÓW
        this.colorConfig = {
            temperature: 4300,  // Kelvin (2000-10000, 3200 = ciepły)
            tint: -30,          // Skala -100/+100 (- = zielony, + = magenta/różowy)
            exposure: 1.9       // Jasność ogólna
        };
    }

    async init() {
        this._createScene();
        this._createCamera();
        this._createRenderer();
        this._createControls();
        this._createLights();
        window.addEventListener('resize', () => this._onResize());
        this._onResize();
        this._animate();
        return true;
    }

    _createScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf8f9fa);
    }

    _createCamera() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        this.camera.position.set(0, 0, 5);
    }

    _createRenderer() {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = this.colorConfig.exposure;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    _createControls() {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
    }

    // Konwersja temperatury Kelvin na RGB
    _kelvinToRGB(kelvin) {
        const temp = kelvin / 100;
        let red, green, blue;

        if (temp <= 66) {
            red = 255;
            green = temp <= 19 ? 0 : 99.4708025861 * Math.log(temp - 10) - 161.1195681661;
            blue = temp >= 66 ? 255 : temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
        } else {
            red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
            green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
            blue = 255;
        }

        return {
            r: Math.max(0, Math.min(255, red)) / 255,
            g: Math.max(0, Math.min(255, green)) / 255,
            b: Math.max(0, Math.min(255, blue)) / 255
        };
    }

    // Aplikuj tint do koloru RGB
    _applyTint(rgb, tint) {
        const tintFactor = tint / 100; // Normalizuj do -1/+1

        if (tintFactor > 0) {
            // Pozytywny tint = więcej magenty/czerwieni
            rgb.r = Math.min(1, rgb.r + tintFactor * 0.2);
            rgb.g = Math.max(0, rgb.g - tintFactor * 0.1);
        } else {
            // Negatywny tint = więcej zieleni
            rgb.g = Math.min(1, rgb.g - tintFactor * 0.2);
            rgb.r = Math.max(0, rgb.r + tintFactor * 0.1);
        }

        return rgb;
    }

    // Konwertuj RGB na hex dla THREE.js
    _rgbToHex(rgb) {
        const r = Math.round(rgb.r * 255);
        const g = Math.round(rgb.g * 255);
        const b = Math.round(rgb.b * 255);
        return (r << 16) | (g << 8) | b;
    }

    // Oblicz kolor na podstawie temperatury i tintu
    _calculateLightColor(intensityMultiplier = 1.0) {
        let rgb = this._kelvinToRGB(this.colorConfig.temperature);
        rgb = this._applyTint(rgb, this.colorConfig.tint);

        // Dostosuj intensywność
        rgb.r = Math.min(1, rgb.r * intensityMultiplier);
        rgb.g = Math.min(1, rgb.g * intensityMultiplier);
        rgb.b = Math.min(1, rgb.b * intensityMultiplier);

        return this._rgbToHex(rgb);
    }

    _createLights() {
        const baseColor = this._calculateLightColor();
        const dimColor = this._calculateLightColor(0.9);
        const warmColor = this._calculateLightColor(1.1);

        // Ambient light
        this.scene.add(new THREE.AmbientLight(baseColor, 1.8));

        // Główne światło z góry
        const dir1 = new THREE.DirectionalLight(baseColor, 1.0);
        dir1.position.set(5, 10, 5);
        dir1.castShadow = true;
        dir1.shadow.mapSize.width = 2048;
        dir1.shadow.mapSize.height = 2048;
        this.scene.add(dir1);

        // Światło wypełniające
        const dir2 = new THREE.DirectionalLight(dimColor, 0.7);
        dir2.position.set(-5, -5, -5);
        this.scene.add(dir2);

        // Dodatkowe światło z boku
        const dir3 = new THREE.DirectionalLight(warmColor, 0.4);
        dir3.position.set(-10, 2, 8);
        this.scene.add(dir3);
    }

    _onResize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    async loadProduct(data) {
        const res = await fetch('/preview3d-ar/api/product-3d', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('API error');
        const cfg = await res.json();

        // remove old mesh
        if (this.currentMesh) {
            this.scene.remove(this.currentMesh);
            this.currentMesh.traverse(o => {
                if (o.isMesh) {
                    o.geometry.dispose();
                    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                    else o.material.dispose();
                }
            });
        }

        const { dimensions } = cfg.geometry;
        const lamW = 4 / 100;
        const count = Math.round(dimensions.width / 4);
        const group = new THREE.Group();

        let prevFace = null;
        let prevSide = null;

        for (let i = 0; i < count; i++) {
            // unique face
            let fi;
            do { fi = Math.floor(Math.random() * cfg.materials.face.variants.length); }
            while (fi === prevFace && cfg.materials.face.variants.length > 1);
            prevFace = fi;

            // unique side
            let si;
            do { si = Math.floor(Math.random() * cfg.materials.side.variants.length); }
            while (si === prevSide && cfg.materials.side.variants.length > 1);
            prevSide = si;

            const facePath = cfg.materials.face.variants[fi];
            const sidePath = cfg.materials.side.variants[si];
            const edgeList = cfg.materials.edge.variants;
            const edgePath = edgeList[Math.floor(Math.random() * edgeList.length)];

            // random rotation for side in 0,90,180,270 deg
            const sideRot = (Math.floor(Math.random() * 4) * Math.PI) / 2;
            // mats: right, left, top, bottom, front, back
            const mats = [
                await this._loadMat(sidePath, sideRot),
                await this._loadMat(sidePath, sideRot + Math.PI),
                await this._loadMat(facePath, Math.PI / 2),
                await this._loadMat(facePath, Math.PI / 2 + Math.PI),
                await this._loadMat(edgePath, 0),
                await this._loadMat(edgePath, Math.PI)
            ];

            const geom = new THREE.BoxGeometry(
                dimensions.length / 100,
                dimensions.thickness / 100,
                lamW
            );
            const mesh = new THREE.Mesh(geom, mats);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.position.set(0, 0, -(count * lamW) / 2 + lamW / 2 + i * lamW);
            group.add(mesh);
        }

        this.currentMesh = group;
        this.scene.add(group);

        // camera fit
        const maxd = Math.max(dimensions.length, dimensions.width, dimensions.thickness) / 100;
        this.camera.position.set(maxd * 2, maxd * 2, maxd * 2);
        this.controls.minDistance = maxd * 0.5;
        this.controls.maxDistance = maxd * 5;
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    _loadMat(url, rotationAngle) {
        return new Promise(resolve => {
            new THREE.TextureLoader().load(url, tex => {
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                tex.encoding = THREE.sRGBEncoding;
                tex.center.set(0.5, 0.5);
                tex.rotation = rotationAngle;
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;

                // Oblicz kolor materiału na podstawie konfiguracji
                const materialColor = this._calculateLightColor(0.95);

                const material = new THREE.MeshPhysicalMaterial({
                    map: tex,
                    color: materialColor,   // Automatycznie obliczony kolor
                    roughness: 0.9,
                    metalness: 0,
                    clearcoat: 0,
                    emissive: 0x0a0604,
                    emissiveIntensity: 0.15,
                    transmission: 0,
                    ior: 1.0,
                    reflectivity: 0.1
                });

                resolve(material);
            }, undefined, () => resolve(new THREE.MeshPhysicalMaterial({
                color: 0x999999,
                roughness: 0.6
            })));
        });
    }

    resetCamera() {
        if (this.currentMesh) {
            const maxd = Math.max(
                this.currentMesh.children[0]?.geometry?.parameters?.width || 1,
                this.currentMesh.children[0]?.geometry?.parameters?.height || 1,
                this.currentMesh.children[0]?.geometry?.parameters?.depth || 1
            );
            this.camera.position.set(maxd * 2, maxd * 2, maxd * 2);
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }

    // Publiczne metody do zmiany kolorów
    setTemperature(kelvin) {
        this.colorConfig.temperature = Math.max(2000, Math.min(10000, kelvin));
        this._updateLighting();
    }

    setTint(tint) {
        this.colorConfig.tint = Math.max(-100, Math.min(100, tint));
        this._updateLighting();
    }

    setExposure(exposure) {
        this.colorConfig.exposure = Math.max(0.1, Math.min(3.0, exposure));
        this.renderer.toneMappingExposure = this.colorConfig.exposure;
    }

    _updateLighting() {
        // Usuń stare światła
        const lightsToRemove = [];
        this.scene.traverse(child => {
            if (child.isLight) lightsToRemove.push(child);
        });
        lightsToRemove.forEach(light => this.scene.remove(light));

        // Stwórz nowe światła
        this._createLights();
    }
}

window.WoodViewer = WoodViewer;