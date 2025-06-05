import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

export function initSceneAndCamera(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.set(0, 1.6, 0) // 玩家眼高约 1.6m
  return { scene, camera }
}

export function addHelpers(scene: THREE.Scene): void {
  const grid = new THREE.GridHelper(100, 100)
  scene.add(grid)

  const axes = new THREE.AxesHelper(5)
  scene.add(axes)
}

export function createTestCube(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
  const cube = new THREE.Mesh(geometry, material)
  cube.position.set(0, 0.5, -5)
  return cube
}

export function initRenderer(container: HTMLDivElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  container.appendChild(renderer.domElement)
  return renderer
}

export function createGround(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(100, 100)
  const material = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide })
  const ground = new THREE.Mesh(geometry, material)
  ground.rotation.x = -Math.PI / 2
  return ground
}

export function createPlayerMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(0.5, 1.6, 0.5)
  const material = new THREE.MeshBasicMaterial({ visible: false })
  const playerMesh = new THREE.Mesh(geometry, material)
  playerMesh.position.set(0, 0.8, 0)
  return playerMesh
}

export function addLighting(scene: THREE.Scene): void {
  const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1)
  scene.add(light)
}

export function initControls(camera: THREE.Camera, domElement: HTMLElement): PointerLockControls {
  const controls = new PointerLockControls(camera, domElement)
  domElement.addEventListener('click', () => controls.lock())
  controls.addEventListener('lock', () => console.log('Pointer locked'))
  controls.addEventListener('unlock', () => console.log('Pointer unlocked'))
  return controls
}

export function setupKeyboardControls(
  keys: Record<string, boolean>,
  velocity: THREE.Vector3,
  jumpSpeed: number,
  canJumpRef: { value: boolean },
): void {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && canJumpRef.value) {
      velocity.y = jumpSpeed
      canJumpRef.value = false
    } else if (keys.hasOwnProperty(e.key)) {
      keys[e.key] = true
    }
  })

  window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) keys[e.key] = false
  })
}

export function createFakeBodyModel(): THREE.Object3D {
  const model = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x00ffcc }),
  )
  model.position.set(0, -0.3, -0.5)
  return model
}
const mixers: THREE.AnimationMixer[] = []
export function loadFirstPersonModel(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new FBXLoader()
    loader.load(
      url,
      (fbx) => {
        const model = fbx
        // 缩放模型（根据你模型的原始尺寸调整）
        model.scale.set(0.001, 0.001, 0.001)
        model.rotation.set(0, Math.PI, 0)

        // 调整位置，使其位于相机视野内
        model.position.set(0, -0.3, -0.5)

        // 动画部分
        const mixer = new THREE.AnimationMixer(fbx)
        const action = mixer.clipAction(fbx.animations[0])
        action.play()

        // 保存 mixer，用于在动画循环中更新
        mixers.push(mixer)

        resolve(model)
      },
      undefined,
      (error) => reject(error),
    )
  })
}

export function animate(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  controls: PointerLockControls,
  playerMesh: THREE.Mesh,
  ground: THREE.Mesh,
  keys: Record<string, boolean>,
  velocity: THREE.Vector3,
  moveSpeed: number,
  runMultiplier: number,
  gravity: number,
  canJumpRef: { value: boolean },
  animationIdRef: { value: number },
): void {
  const raycaster = new THREE.Raycaster()
  const clock = new THREE.Clock()

  function render() {
    animationIdRef.value = requestAnimationFrame(render)
    const delta = clock.getDelta()

    // 重力
    velocity.y -= gravity * delta

    // 地面检测
    raycaster.set(playerMesh.position.clone(), new THREE.Vector3(0, -1, 0))
    const intersects = raycaster.intersectObject(ground)
    if (intersects.length > 0 && intersects[0].distance < 0.85) {
      velocity.y = Math.max(0, velocity.y)
      canJumpRef.value = true
    }

    // 走/跑方向与速度
    const speed = moveSpeed * (keys.Shift ? runMultiplier : 1)
    const direction = new THREE.Vector3()
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(camera.up, forward).normalize()

    if (keys.w) direction.add(forward)
    if (keys.s) direction.sub(forward)
    if (keys.d) direction.sub(right)
    if (keys.a) direction.add(right)
    if (direction.lengthSq() > 0) {
      direction.normalize()
      playerMesh.position.addScaledVector(direction, speed * delta)
    }

    // 更新垂直位置与相机同步
    playerMesh.position.y += velocity.y * delta
    controls.object.position.copy(playerMesh.position)

    // 调用动画混合器更新动画
    mixers.forEach((mixer) => mixer.update(delta))

    renderer.render(scene, camera)
  }

  render()
}
