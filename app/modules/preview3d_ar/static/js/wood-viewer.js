class WoodViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.currentMesh = null;
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
        // disable tone mapping for neutral colors
        this.renderer.toneMapping = THREE.NoToneMapping;
    }

    _createControls() {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
    }

    _createLights() {
        // only neutral white light
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
        dir1.position.set(5, 10, 5);
        dir1.castShadow = true;
        this.scene.add(dir1);
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dir2.position.set(-5, -5, -5);
        this.scene.add(dir2);
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
                resolve(new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.8, metalness: 0 }));
            }, undefined, () => resolve(new THREE.MeshPhysicalMaterial({ color: 0x999999, roughness: 0.8 })));
        });
    }
}

window.WoodViewer = WoodViewer;