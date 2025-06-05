// Używamy globalnych obiektów: THREE, CSG, React, ReactDOM, THREE.OrbitControls

const CSG = THREE.CSG;
if (!CSG) console.error("CSG nie jest zdefiniowane!");

const Edge3DViewer = ({ dimensions, edgeSettings = {} }) => {
    const containerRef = React.useRef(null);
    const sceneRef = React.useRef(null);
    const cameraRef = React.useRef(null);
    const rendererRef = React.useRef(null);
    const controlsRef = React.useRef(null);

    React.useEffect(() => {
        if (typeof CSG === 'undefined') console.error('CSG nie jest zdefiniowane – upewnij się, że załadowałeś bibliotekę three-csgmesh');
        console.log('Edge3DViewer: useEffect fired with dimensions', dimensions);
        console.log('Edge3DViewer: edgeSettings keys', Object.keys(edgeSettings || {}));
        console.log('Edge3DViewer: initializing scene');
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);
        sceneRef.current = scene;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(200, 150, 200);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        controlsRef.current = new THREE.OrbitControls(camera, renderer.domElement);
        controlsRef.current.enableDamping = true;

        scene.add(
            new THREE.AmbientLight(0xffffff, 0.5),
            new THREE.DirectionalLight(0xffffff, 0.6),
            new THREE.HemisphereLight(0xffffff, 0x444444, 0.5)
        );

        function animate() {
            requestAnimationFrame(animate);
            controlsRef.current.update();
            renderer.render(scene, camera);
        }
        animate();
    }, []);

    React.useEffect(() => {
        console.log('Edge3DViewer: updating model with settings', edgeSettings);
        const scene = sceneRef.current;
        if (!scene) return;

        scene.children.filter(o => o.userData?.isBox).forEach(o => scene.remove(o));

        let box = new THREE.Mesh(
            new THREE.BoxGeometry(dimensions.length, dimensions.height, dimensions.width),
            new THREE.MeshStandardMaterial({ color: 0xdddddd })
        );
        box.userData.isBox = true;

        Object.entries(edgeSettings || {}).forEach(([key, cfg]) => {
            if (cfg.type === 'frezowana' && cfg.value > 0) {
                console.log(`Edge3DViewer: applying frezowana on ${key} value=${cfg.value}`);
                box = applyFillet(box, key, cfg.value);
            }
            if (cfg.type === 'fazowana' && cfg.angle > 0) {
                console.log(`Edge3DViewer: applying fazowana on ${key} angle=${cfg.angle}`);
                box = applyChamfer(box, key, cfg.angle);
            }
        });

        scene.add(box);
    }, [dimensions, edgeSettings]);

    return React.createElement('div', { ref: containerRef, style: { width: '100%', height: '400px' } });
};

function applyFillet(mesh, edgeKey, radius) {
    console.log(`applyFillet: key=${edgeKey}, radius=${radius}`);

    const geometry = mesh.geometry.clone();
    const material = mesh.material;
    const dimensions = mesh.geometry.parameters;
    const maxDim = Math.max(dimensions.width, dimensions.height, dimensions.depth);

    const cyl = new THREE.CylinderGeometry(radius, radius, 2 * maxDim, 16);
    cyl.rotateZ(Math.PI / 2);
    const toolMesh = new THREE.Mesh(cyl);
    toolMesh.position.copy(getEdgeCenterPoint(edgeKey, dimensions));
    toolMesh.updateMatrix();

    // 💡 Oto właściwa linia – używamy CSG.fromMesh!
    const bspBox = CSG.fromMesh(new THREE.Mesh(geometry, material));
    const bspTool = CSG.fromMesh(toolMesh);

    const result = bspBox.subtract(bspTool);
    const meshOut = CSG.toMesh(result, mesh.matrix, material);
    meshOut.userData.isBox = true;
    return meshOut;
}

function applyChamfer(mesh, edgeKey, angle) {
    console.log(`applyChamfer: key=${edgeKey}, angle=${angle}`);
    const geometry = mesh.geometry.clone();
    const material = mesh.material;
    const dimensions = mesh.geometry.parameters;
    const maxDim = Math.max(dimensions.width, dimensions.height, dimensions.depth);

    const chamferGeo = new THREE.BoxGeometry(2 * maxDim, 2 * maxDim, 2 * maxDim);
    const toolMesh = new THREE.Mesh(chamferGeo);
    toolMesh.position.copy(getEdgeCenterPoint(edgeKey, dimensions));
    const rot = getChamferRotation(edgeKey, angle);
    if (rot) toolMesh.rotation.set(rot.x, rot.y, rot.z);
    toolMesh.updateMatrix();

    const bspBox = CSG.fromMesh(new THREE.Mesh(geometry, material));
    const bspTool = CSG.fromMesh(toolMesh);
    const result = bspBox.subtract(bspTool);
    const meshOut = CSG.toMesh(result, mesh.matrix, material);
    meshOut.userData.isBox = true;
    return meshOut;
}

function getEdgeCenterPoint(edgeKey, dimensions) {
    const { length, width, height } = dimensions;
    const halfL = length / 2;
    const halfW = width / 2;
    const halfH = height / 2;

    const centerMap = {
        "top-front": new THREE.Vector3(0, halfH, -halfW),
        "top-back": new THREE.Vector3(0, halfH, halfW),
        "top-left": new THREE.Vector3(-halfL, halfH, 0),
        "top-right": new THREE.Vector3(halfL, halfH, 0),
        "bottom-front": new THREE.Vector3(0, -halfH, -halfW),
        "bottom-back": new THREE.Vector3(0, -halfH, halfW),
        "bottom-left": new THREE.Vector3(-halfL, -halfH, 0),
        "bottom-right": new THREE.Vector3(halfL, -halfH, 0),
        "left-front": new THREE.Vector3(-halfL, 0, -halfW),
        "left-back": new THREE.Vector3(-halfL, 0, halfW),
        "right-front": new THREE.Vector3(halfL, 0, -halfW),
        "right-back": new THREE.Vector3(halfL, 0, halfW)
    };

    return centerMap[edgeKey] || new THREE.Vector3(0, 0, 0);
}

function getChamferRotation(edgeKey, angle) {
    const degToRad = angle => angle * (Math.PI / 180);
    const rotMap = {
        "top-front": new THREE.Vector3(degToRad(-45), 0, 0),
        "top-back": new THREE.Vector3(degToRad(45), 0, 0),
        "bottom-front": new THREE.Vector3(degToRad(45), 0, 0),
        "bottom-back": new THREE.Vector3(degToRad(-45), 0, 0),
        "top-left": new THREE.Vector3(0, 0, degToRad(-45)),
        "top-right": new THREE.Vector3(0, 0, degToRad(45)),
        "bottom-left": new THREE.Vector3(0, 0, degToRad(45)),
        "bottom-right": new THREE.Vector3(0, 0, degToRad(-45))
    };
    return rotMap[edgeKey] || null;
}

window.Edge3DViewer = Edge3DViewer;
