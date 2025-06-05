<template>
  <div v-show="loading" class="loading-overlay">Loading...</div>
  <div v-show="!loading" ref="container" class="fps-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import IdleFbx from '@/assets/models/fbx/Idle.fbx'
import RunningFbx from '@/assets/models/fbx/Running.fbx'
import SoilBackground from '@/assets/textures/soil_background.png'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

// 新增类型定义
type CharacterModels = {
  idle: THREE.Group
  run: THREE.Group
  active: () => THREE.Group // 动态获取当前活跃模型
}

// 新增相机偏移常量
const mixers: THREE.AnimationMixer[] = []
const ROTATION_SPEED = 8 // 角色转向速度
const MOUSE_SENSITIVITY = 0.002 // 鼠标旋转灵敏度

const container = ref<HTMLDivElement>()
const loading = ref(true)
const animationId = { value: 0 }
const keys: Record<string, boolean> = { w: false, a: false, s: false, d: false, Space: false }

onMounted(async () => {
  loading.value = true
  const { scene, camera } = initSceneAndCamera()
  const dom = container.value!
  const renderer = initRenderer(dom)

  // 加载角色模型
  const models = await loadCharacterModels()
  renderer.compile(scene, camera)
  scene.add(models.idle)
  scene.add(models.run)

  // 添加场景元素
  createGround().then((ground) => {
    scene.add(ground)
  })
  addLighting(scene)
  setupKeyboardControls(keys)

  // 初始化草地系统
  const grassSystem = new GrassGenerator(scene, 15000)

  // 初始化轨道控制器
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.target.copy(models.active().position)
  controls.enablePan = false // 禁用平移
  controls.enableZoom = false // 禁用缩放
  controls.autoRotate = false // 禁用自动旋转

  // 添加指针锁定
  renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock()
  })

  animate({
    scene,
    camera,
    renderer,
    models,
    onAnimation() {
      const time = performance.now() * 0.001
      grassSystem.animate(time)
    },
  })

  loading.value = false
})

// 修改后的动画函数
function animate({
  scene,
  camera,
  renderer,
  models,
  onAnimation,
}: {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  models: CharacterModels
  onAnimation?: (delta: number) => void
}): void {
  const clock = new THREE.Clock()
  const controller = new ThirdPersonController(camera, renderer.domElement, models)

  function render() {
    const delta = clock.getDelta()

    onAnimation?.(delta)
    animationId.value = requestAnimationFrame(render)

    // 更新相机跟随
    controller.update(delta)
    renderer.render(scene, camera)
  }

  render()
}

// 草地生成工具类
class GrassGenerator {
  private scene: THREE.Scene
  private grassCount: number
  private grassMesh!: THREE.InstancedMesh

  constructor(scene: THREE.Scene, count: number = 10000) {
    this.scene = scene
    this.grassCount = count
    this.init()
  }

  // 初始化草地系统
  private async init() {
    // 创建单根草叶模型（Y轴垂直向上）
    const bladeGeometry = this.createBladeGeometry()
    const bladeMaterial = this.createBladeMaterial()

    // 创建实例化网格
    this.grassMesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, this.grassCount)

    // 设置实例属性
    this.populateGrassField()

    // 添加到场景
    this.scene.add(this.grassMesh)
  }

  // 创建草叶几何体（高度1.2米，底部宽0.3米）
  private createBladeGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const vertices = new Float32Array([
      // X    Y    Z  （底部中心为原点）
      -0.01,
      0.0,
      0.0, // 底部左
      0.01,
      0.0,
      0.0, // 底部右
      0.0,
      0.5,
      0.0, // 顶部中心
    ])

    const indices = [
      0,
      1,
      2, // 单个三角形面片
    ]

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    return geometry
  }

  // 创建草叶材质
  private createBladeMaterial(): THREE.Material {
    return new THREE.MeshStandardMaterial({
      color: 0x88ff88,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.7,
      metalness: 0,
    })
  }

  // 生成草地实例
  private populateGrassField() {
    const dummy = new THREE.Object3D()
    const scaleVariation = 0.3

    for (let i = 0; i < this.grassCount; i++) {
      // 随机位置（XZ平面）
      dummy.position.set(
        Math.random() * 100 - 50,
        0, // Y轴固定在地面
        Math.random() * 100 - 50,
      )

      // 随机旋转（仅绕Y轴）
      dummy.rotation.y = Math.random() * Math.PI * 2

      // 随机缩放（保持Y轴为主生长方向）
      dummy.scale.set(
        1 + (Math.random() - 0.5) * scaleVariation,
        1 + Math.random() * 0.5,
        1 + (Math.random() - 0.5) * scaleVariation,
      )

      dummy.updateMatrix()
      this.grassMesh.setMatrixAt(i, dummy.matrix)
    }

    this.grassMesh.instanceMatrix.needsUpdate = true
  }

  // 添加风场动画
  public animate(time: number) {
    const dummy = new THREE.Object3D()
    const windStrength = 0.3

    for (let i = 0; i < this.grassCount; i++) {
      this.grassMesh.getMatrixAt(i, dummy.matrix)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)

      // 基于噪声的摆动效果
      const noise = Math.sin(time * 2 + i * 0.1) * windStrength
      dummy.rotation.z = noise * 0.2
      dummy.position.y = Math.abs(noise) * 0.1

      dummy.updateMatrix()
      this.grassMesh.setMatrixAt(i, dummy.matrix)
    }

    this.grassMesh.instanceMatrix.needsUpdate = true
  }
}

// 修改后的角色控制类
class ThirdPersonController {
  private currentPosition = new THREE.Vector3()
  private yaw = 0 // 新增：水平旋转角度
  private pitch = 0 // 新增：垂直旋转角度
  private readonly MAX_PITCH = Math.PI / 6 // 30度最大仰角（原神风格）
  private readonly MIN_PITCH = -Math.PI / 3.5 // -50度最大俯角
  private readonly GROUND_Y = 0 // 地面高度
  private readonly moveSpeed = 3 // 角色移动速度
  private isMoving = false // 是否移动

  constructor(
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
    private models: CharacterModels,
  ) {
    // 添加鼠标移动事件
    domElement.addEventListener('mousemove', this.onMouseMove.bind(this))
    domElement.style.cursor = 'grab' // 修改鼠标样式
  }

  private onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement !== this.domElement) return

    // 垂直灵敏度比水平低约30%
    const verticalSensitivity = MOUSE_SENSITIVITY * 0.7
    const horizontalSensitivity = MOUSE_SENSITIVITY

    // 应用旋转
    this.yaw -= event.movementX * horizontalSensitivity
    this.pitch = Math.max(
      this.MIN_PITCH,
      Math.min(this.MAX_PITCH, this.pitch - event.movementY * verticalSensitivity),
    )
  }

  private move(delta: number) {
    // 角色移动控制
    const moveDirection = new THREE.Vector3()
    if (keys.w) moveDirection.z -= this.moveSpeed * delta
    if (keys.s) moveDirection.z += this.moveSpeed * delta
    if (keys.a) moveDirection.x -= this.moveSpeed * delta
    if (keys.d) moveDirection.x += this.moveSpeed * delta

    if (moveDirection.lengthSq() > 0) {
      this.isMoving = true

      // 基于相机朝向计算移动方向
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
      forward.y = 0
      forward.normalize()

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
      right.y = 0
      right.normalize()

      // 组合方向
      const direction = new THREE.Vector3()
      if (keys.w) direction.add(forward)
      if (keys.s) direction.sub(forward)
      if (keys.a) direction.sub(right)
      if (keys.d) direction.add(right)

      if (direction.lengthSq() > 0) {
        direction.normalize()
        this.models.idle.position.addScaledVector(direction, this.moveSpeed * delta)
        this.models.run.position.addScaledVector(direction, this.moveSpeed * delta)

        // 角色朝向移动方向
        const targetRotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, Math.atan2(direction.x, direction.z), 0),
        )
        this.models.idle.quaternion.slerp(targetRotation, delta * ROTATION_SPEED)
        this.models.run.quaternion.slerp(targetRotation, delta * ROTATION_SPEED)
      }
    } else {
      this.isMoving = false
    }

    // 更新动画
    if (this.isMoving) {
      this.models.idle.visible = false
      this.models.run.visible = true
    } else {
      this.models.run.visible = false
      this.models.idle.visible = true
    }

    mixers[0].update(delta) // 站立动画混合器
    mixers[0].clipAction(this.models.idle.animations[0]).play()
    mixers[1].update(delta) // 跑步动画混合器
    mixers[1].clipAction(this.models.run.animations[0]).play()
  }

  update(delta: number) {
    this.move(delta)

    // 1. 计算理想偏移
    const idealOffset = new THREE.Vector3(0, 1.5, 4)
      .applyQuaternion(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YZX')),
      )
      .add(this.models.active().position)

    // 2. 地面碰撞检测
    idealOffset.y = Math.max(this.GROUND_Y + 0.3, idealOffset.y)

    // 3. 平滑移动
    this.currentPosition.lerp(idealOffset, delta * 10)
    this.camera.position.copy(this.currentPosition)

    // 4. 强制视线高于地面
    const lookAtY = Math.max(this.models.active().position.y + 0.8, this.GROUND_Y + 0.5)
    this.camera.lookAt(this.models.active().position.x, lookAtY, this.models.active().position.z)
  }
}

function initSceneAndCamera(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  return { scene, camera }
}

function addLighting(scene: THREE.Scene): void {
  // 增强主光源强度
  const sunLight = new THREE.DirectionalLight(0xffeecc, 2.5) // 改为暖色调高强度
  sunLight.position.set(30, 100, -20) // 调整光源位置
  sunLight.castShadow = true
  sunLight.shadow.mapSize.width = 2048 // 降低分辨率提升性能
  sunLight.shadow.mapSize.height = 2048
  sunLight.shadow.camera.near = 0.5
  sunLight.shadow.camera.far = 500
  scene.add(sunLight)

  // 添加补光
  const fillLight = new THREE.DirectionalLight(0xccddff, 0.8) // 冷色补光
  fillLight.position.set(-30, 50, 30)
  scene.add(fillLight)

  // 增强环境光
  const ambientLight = new THREE.AmbientLight(0xffffff, 2) // 强度从0.3提升到0.8
  scene.add(ambientLight)
}

async function createGround() {
  const geometry = new THREE.PlaneGeometry(100, 100)

  // 加载草地纹理（需要准备textures/grass目录下的贴图文件）
  const textureLoader = new THREE.TextureLoader()

  const [diffuseMap, normalMap, displacementMap] = await Promise.all([
    textureLoader.loadAsync(SoilBackground),
    textureLoader.loadAsync(SoilBackground),
    textureLoader.loadAsync(SoilBackground),
  ])

  // 配置纹理参数
  const wrapMode = THREE.RepeatWrapping
  const repeat = 50
  void [diffuseMap, normalMap, displacementMap].forEach((map) => {
    map.wrapS = wrapMode
    map.wrapT = wrapMode
    map.repeat.set(repeat, repeat)
  })

  // 创建PBR材质
  const material = new THREE.MeshStandardMaterial({
    map: diffuseMap,
    normalMap: normalMap,
    displacementMap: displacementMap,
    displacementScale: 0.1, // 减少地形起伏强度
    roughness: 0.6, // 降低粗糙度（更光滑）
    metalness: 0.0, // 完全非金属材质
    emissive: 0x334422, // 添加自发光模拟草叶反光
    emissiveIntensity: 0.2,
  })

  const ground = new THREE.Mesh(geometry, material)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true // 开启阴影接收
  ground.name = 'ground'

  return ground
}

function initRenderer(container: HTMLDivElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  container.appendChild(renderer.domElement)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  return renderer
}

function setupKeyboardControls(keys: Record<string, boolean>): void {
  window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) {
      keys[e.key] = true
    }
  })

  window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) keys[e.key] = false
  })
}

// 修改后的模型加载函数
async function loadCharacterModels(): Promise<CharacterModels> {
  const [idleModel, runModel] = await Promise.all([
    new FBXLoader().loadAsync(IdleFbx),
    new FBXLoader().loadAsync(RunningFbx),
  ])

  // 统一设置
  void [idleModel, runModel].forEach((model) => {
    const mixer = new THREE.AnimationMixer(model)
    mixers.push(mixer)
    model.scale.set(0.01, 0.01, 0.01)
    model.position.set(0, 0, 0)
    model.visible = true
    model.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
  })

  return {
    idle: idleModel,
    run: runModel,
    active: () => (runModel.visible ? runModel : idleModel),
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', () => {})
  window.removeEventListener('keyup', () => {})
})
</script>

<style scoped>
.loading-overlay {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
