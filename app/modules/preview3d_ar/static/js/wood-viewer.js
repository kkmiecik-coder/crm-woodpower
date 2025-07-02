// app/modules/preview3d_ar/static/js/wood-viewer.js

class WoodViewer {
    constructor(canvas) {
        console.log('[WoodViewer] Constructor - canvas:', canvas);

        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.currentMesh = null;
        this.shadowPlane = null;
        this.isInitialized = false;

        // KONFIGURACJA KOLORÓW
        this.colorConfig = {
            temperature: 4300,  // Kelvin (2000-10000, 3200 = ciepły)
            tint: -30,          // Skala -100/+100 (- = zielony, + = magenta/różowy)
            exposure: 1.9       // Jasność ogólna
        };

        // Sprawdź canvas od razu
        if (!canvas) {
            throw new Error('Canvas element is required');
        }

        console.log('[WoodViewer] Constructor finished');
    }

    async init() {
        console.log('[WoodViewer] Starting initialization...');

        try {
            // Sprawdź THREE.js
            if (typeof THREE === 'undefined') {
                throw new Error('THREE.js is not loaded');
            }

            // Sprawdź canvas
            if (!this.canvas) {
                throw new Error('Canvas element is null');
            }

            const canvasRect = this.canvas.getBoundingClientRect();
            console.log('[WoodViewer] Canvas size:', canvasRect.width, 'x', canvasRect.height);

            if (canvasRect.width === 0 || canvasRect.height === 0) {
                console.warn('[WoodViewer] Canvas has zero size, setting default size');
                this.canvas.style.width = '800px';
                this.canvas.style.height = '600px';
            }

            // Inicjalizuj komponenty w kolejności
            console.log('[WoodViewer] Creating scene...');
            this._createScene();

            console.log('[WoodViewer] Creating camera...');
            this._createCamera();

            console.log('[WoodViewer] Creating renderer...');
            this._createRenderer();

            console.log('[WoodViewer] Creating controls...');
            this._createControls();

            console.log('[WoodViewer] Creating lights...');
            this._createLights();

            console.log('[WoodViewer] Creating shadow plane...');
            this._createShadowPlane();

            // Event listenery
            window.addEventListener('resize', () => this._onResize());
            this._onResize();

            // Start animacji
            this._animate();

            this.isInitialized = true;
            console.log('[WoodViewer] Initialization completed successfully');

            return true;

        } catch (error) {
            console.error('[WoodViewer] Initialization failed:', error);
            throw error;
        }
    }

    _createScene() {
        console.log('[WoodViewer] Creating THREE.Scene...');
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf8f9fa);
        console.log('[WoodViewer] Scene created:', this.scene);
    }

    _createCamera() {
        console.log('[WoodViewer] Creating camera...');
        const w = this.canvas.clientWidth || 800;
        const h = this.canvas.clientHeight || 600;
        console.log('[WoodViewer] Camera dimensions:', w, 'x', h);

        this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
        this.camera.position.set(8, 8, 8);
        console.log('[WoodViewer] Camera created:', this.camera);
    }

    _createRenderer() {
        console.log('[WoodViewer] Creating renderer...');
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false,
            powerPreference: "high-performance"
        });

        const w = this.canvas.clientWidth || 800;
        const h = this.canvas.clientHeight || 600;

        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // WŁĄCZ CIENIE
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Miękkie cienie
        
        // Lepsze renderowanie kolorów
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this.colorConfig.exposure;
        
        // Lepsze zarządzanie pamięcią
        this.renderer.info.autoReset = false;

        console.log('[WoodViewer] Renderer created:', this.renderer);
    }

    _createControls() {
        console.log('[WoodViewer] Creating controls...');
        
        if (typeof THREE.OrbitControls === 'undefined') {
            throw new Error('OrbitControls is not loaded');
        }

        this.controls = new THREE.OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = 2;
        this.controls.maxDistance = 50;
        this.controls.maxPolarAngle = Math.PI * 0.8;

        console.log('[WoodViewer] Controls created:', this.controls);
    }

    _createLights() {
        console.log('[WoodViewer] Creating lights...');

        // Usuń istniejące światła
        const existingLights = [];
        this.scene.traverse(child => {
            if (child.isLight) existingLights.push(child);
        });
        existingLights.forEach(light => this.scene.remove(light));

        // Oblicz kolory światła na podstawie temperatury
        const temp = this.colorConfig.temperature;
        const tint = this.colorConfig.tint;

        function tempToRGB(kelvin) {
            const temp = kelvin / 100;
            let r, g, b;

            if (temp <= 66) {
                r = 255;
                g = temp;
                g = 99.4708025861 * Math.log(g) - 161.1195681661;
                if (temp >= 19) {
                    b = temp - 10;
                    b = 138.5177312231 * Math.log(b) - 305.0447927307;
                } else {
                    b = 0;
                }
            } else {
                r = temp - 60;
                r = 329.698727446 * Math.pow(r, -0.1332047592);
                g = temp - 60;
                g = 288.1221695283 * Math.pow(g, -0.0755148492);
                b = 255;
            }

            return {
                r: Math.max(0, Math.min(255, r)) / 255,
                g: Math.max(0, Math.min(255, g)) / 255,
                b: Math.max(0, Math.min(255, b)) / 255
            };
        }

        const rgb = tempToRGB(temp);
        const tintFactor = tint / 100;

        // Aplikuj tint
        const baseColor = new THREE.Color(
            Math.max(0, Math.min(1, rgb.r + tintFactor * 0.1)),
            Math.max(0, Math.min(1, rgb.g)),
            Math.max(0, Math.min(1, rgb.b - tintFactor * 0.1))
        );

        const dimColor = baseColor.clone().multiplyScalar(0.6);
        const warmColor = baseColor.clone().lerp(new THREE.Color(1, 0.8, 0.6), 0.3);

        // Ambient light - ogólne oświetlenie
        const ambientLight = new THREE.AmbientLight(baseColor, 0.3);
        this.scene.add(ambientLight);

        // Główne światło kierunkowe z cieniem
        const mainLight = new THREE.DirectionalLight(baseColor, 0.8);
        mainLight.position.set(10, 15, 5);
        mainLight.target.position.set(0, 0, 0);
        
        // KONFIGURACJA CIENI
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 50;
        mainLight.shadow.camera.left = -15;
        mainLight.shadow.camera.right = 15;
        mainLight.shadow.camera.top = 15;
        mainLight.shadow.camera.bottom = -15;
        mainLight.shadow.bias = -0.0001;
        mainLight.shadow.normalBias = 0.02;
        
        this.scene.add(mainLight);
        this.scene.add(mainLight.target);

        // Światło wypełniające
        const fillLight = new THREE.DirectionalLight(dimColor, 0.4);
        fillLight.position.set(-8, 8, -8);
        this.scene.add(fillLight);

        // Dodatkowe światło z boku
        const rimLight = new THREE.DirectionalLight(warmColor, 0.3);
        rimLight.position.set(-12, 3, 10);
        this.scene.add(rimLight);

        // Subtelne światło od dołu
        const bottomLight = new THREE.DirectionalLight(baseColor, 0.1);
        bottomLight.position.set(0, -5, 0);
        this.scene.add(bottomLight);

        console.log('[WoodViewer] Lights created - scene children count:', this.scene.children.length);
    }

    _createShadowPlane() {
        console.log('[WoodViewer] Creating shadow plane...');

        // Usuń istniejącą płaszczyznę
        if (this.shadowPlane) {
            this.scene.remove(this.shadowPlane);
            this.shadowPlane = null;
        }

        // Utwórz geometrię płaszczyzny
        const planeGeometry = new THREE.PlaneGeometry(50, 50);
        
        // Material który tylko odbiera cienie
        const planeMaterial = new THREE.ShadowMaterial({
            opacity: 0.25,
            transparent: true
        });
        
        this.shadowPlane = new THREE.Mesh(planeGeometry, planeMaterial);
        this.shadowPlane.rotation.x = -Math.PI / 2; // Obróć żeby była pozioma
        this.shadowPlane.position.y = -2.5; // Umieść pod produktem
        this.shadowPlane.receiveShadow = true; // Odbiera cienie
        this.shadowPlane.name = 'shadowPlane';
        
        this.scene.add(this.shadowPlane);
        
        console.log('[WoodViewer] Shadow plane created');
    }

    _onResize() {
        if (!this.camera || !this.renderer) return;

        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        if (this.controls) {
            this.controls.update();
        }
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    async loadProduct(data) {
        console.log('[WoodViewer] Loading product:', data);

        if (!this.isInitialized) {
            throw new Error('WoodViewer must be initialized before loading products');
        }

        if (!this.scene) {
            throw new Error('Scene is null - WoodViewer not properly initialized');
        }

        try {
            // Wywołaj API
            const res = await fetch('/preview3d-ar/api/product-3d', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`API error: ${res.status} - ${errorText}`);
            }

            const cfg = await res.json();
            console.log('[WoodViewer] API response:', cfg);

            // Sprawdź strukturę odpowiedzi
            if (!cfg.geometry || !cfg.materials) {
                throw new Error('Invalid API response: missing geometry or materials');
            }

            // Usuń poprzedni mesh
            if (this.currentMesh) {
                this.scene.remove(this.currentMesh);
                this.currentMesh = null;
            }

            console.log('[WoodViewer] Creating new mesh...');
            this.currentMesh = await this._createMesh(cfg);
            
            // WŁĄCZ CIENIE DLA PRODUKTU
            this.currentMesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.scene.add(this.currentMesh);

            // Wyśrodkuj kamerę
            this.resetCamera();

            console.log('[WoodViewer] Mesh added to scene - children count:', this.scene.children.length);

            // Force render
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }

            console.log('[WoodViewer] Product loaded successfully');
            return true;

        } catch (error) {
            console.error('[WoodViewer] Error loading product:', error);
            throw error;
        }
    }

    _calculateMaterialColor(baseColor) {
        const color = new THREE.Color(baseColor);
        const temp = this.colorConfig.temperature;
        const tint = this.colorConfig.tint;

        // Zastosuj temperaturę kolorystyczną
        if (temp < 3200) {
            // Ciepłe światło
            color.r = Math.min(1, color.r * 1.1);
            color.g = Math.min(1, color.g * 1.05);
            color.b = Math.max(0, color.b * 0.9);
        } else if (temp > 5500) {
            // Zimne światło
            color.r = Math.max(0, color.r * 0.95);
            color.g = Math.min(1, color.g * 1.02);
            color.b = Math.min(1, color.b * 1.1);
        }

        // Zastosuj tint
        const tintFactor = tint / 1000;
        color.r = Math.max(0, Math.min(1, color.r + tintFactor));
        color.b = Math.max(0, Math.min(1, color.b - tintFactor));

        return color;
    }

    resetCamera() {
        if (this.currentMesh && this.camera && this.controls) {
            // Oblicz bounding box produktu
            const box = new THREE.Box3().setFromObject(this.currentMesh);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = this.camera.fov * (Math.PI / 180);
            let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.5;

            // Minimum distance
            cameraDistance = Math.max(cameraDistance, maxDim * 2);

            this.camera.position.set(
                center.x + cameraDistance * 0.7,
                center.y + cameraDistance * 0.7,
                center.z + cameraDistance * 0.7
            );

            this.controls.target.copy(center);
            this.controls.update();

            console.log('[WoodViewer] Camera reset - position:', this.camera.position, 'target:', this.controls.target);
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
        if (this.renderer) {
            this.renderer.toneMappingExposure = this.colorConfig.exposure;
        }
    }

    _updateLighting() {
        if (!this.scene) return;

        // Usuń stare światła (zachowaj inne obiekty)
        const lightsToRemove = [];
        this.scene.traverse(child => {
            if (child.isLight) lightsToRemove.push(child);
        });
        lightsToRemove.forEach(light => this.scene.remove(light));

        // Stwórz nowe światła
        this._createLights();
    }

    // Debug method
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            hasScene: !!this.scene,
            hasCamera: !!this.camera,
            hasRenderer: !!this.renderer,
            hasControls: !!this.controls,
            hasCurrentMesh: !!this.currentMesh,
            hasShadowPlane: !!this.shadowPlane,
            shadowsEnabled: this.renderer ? this.renderer.shadowMap.enabled : false,
            sceneChildrenCount: this.scene ? this.scene.children.length : 0,
            canvasSize: this.canvas ? {
                width: this.canvas.clientWidth,
                height: this.canvas.clientHeight
            } : null,
            colorConfig: this.colorConfig
        };
    }
}

// Eksportuj klasę globalnie
window.WoodViewer = WoodViewer;

console.log('[WoodViewer] Class loaded successfully');