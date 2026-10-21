// Maestro DJ: modelo do Meshy (rig Mixamo) animado pela mesma pose procedural dos outros bonecos.
// A pose é escrita num "rig de controle" invisível (mesmas juntas e eixos do makePerson); a cada quadro a rotação de
// cada junta, em relação à raiz, vira a rotação do osso Mixamo equivalente (retarget por deltas no espaço da raiz).
// As animações que vêm no arquivo (Running, Walking...) não são usadas.
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import modelUrl from '../art/Meshy_AI_sci_fi_character_rigg_All_Animations.glb?url'

export interface MeshyRig {
  root: THREE.Object3D
  body: THREE.Object3D
  upper: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  foreL: THREE.Object3D
  foreR: THREE.Object3D
  head: THREE.Object3D
  hipL: THREE.Object3D
  hipR: THREE.Object3D
  kneeL: THREE.Object3D
  kneeR: THREE.Object3D
  lens: THREE.Object3D
  sync: () => void
}

// altura do modelo é 1,64 m; o Maestro fica um pouco maior que os outros (como o robô)
const SCALE = 1.18
const HEAD_SCALE = 2

let gltf: GLTF | null = null
let loading: Promise<void> | null = null

export function loadMeshyMaestro(): Promise<void> {
  loading ??= new GLTFLoader().loadAsync(modelUrl).then((g) => {
    gltf = g
  })
  return loading
}

const bone = (root: THREE.Object3D, name: string) => {
  let found: THREE.Bone | null = null
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && (o.name === `mixamorig:${name}` || o.name === `mixamorig${name}` || o.name === name)) found = o as THREE.Bone
  })
  return found as THREE.Bone | null
}

export function makeMeshyMaestro(): MeshyRig | null {
  if (!gltf) return null
  const root = new THREE.Group()
  const model = cloneSkinned(gltf.scene)
  model.scale.setScalar(SCALE)
  root.add(model)
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
    }
  })
  root.updateMatrixWorld(true)

  // T-pose -> braços abaixados (rest das poses procedurais): aponta braço e antebraço para baixo, um pouco abertos
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  const aim = (b: THREE.Bone, child: THREE.Object3D, target: THREE.Vector3) => {
    const dir = wp(child).sub(wp(b)).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(dir, target.clone().normalize())
    const world = b.getWorldQuaternion(new THREE.Quaternion())
    const parent = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
    b.quaternion.copy(parent.invert().multiply(q.multiply(world)))
    root.updateMatrixWorld(true)
  }
  for (const side of ['Left', 'Right']) {
    const arm = bone(model, `${side}Arm`)
    const fore = bone(model, `${side}ForeArm`)
    const hand = bone(model, `${side}Hand`)
    if (!arm || !fore || !hand) continue
    const sx = Math.sign(wp(arm).x) || 1
    aim(arm, fore, new THREE.Vector3(sx * 0.18, -1, 0.04))
    aim(fore, hand, new THREE.Vector3(sx * 0.1, -1, 0.08))
  }

  // rig de controle (mesma hierarquia do makePerson); identidade no repouso
  const P = () => new THREE.Object3D()
  const body = P()
  const upper = P()
  const head = P()
  const armL = P()
  const armR = P()
  const foreL = P()
  const foreR = P()
  const hipL = P()
  const hipR = P()
  const kneeL = P()
  const kneeR = P()
  const lens = new THREE.Group()
  lens.visible = false
  root.add(body)
  body.add(hipL, hipR, upper)
  hipL.add(kneeL)
  hipR.add(kneeR)
  upper.add(armL, armR, head)
  armL.add(foreL)
  armR.add(foreR)
  foreR.add(lens)

  // "L" das poses é o lado x < 0 (como no makePerson): casa pelo lado em que o osso está
  const left = bone(model, 'LeftArm')
  const leftIsNegX = left ? wp(left).x < 0 : false
  const neg = leftIsNegX ? 'Left' : 'Right'
  const pos = leftIsNegX ? 'Right' : 'Left'
  const map: [THREE.Object3D, string][] = [
    [body, 'Hips'], [upper, 'Spine'], [head, 'Head'],
    [armL, `${neg}Arm`], [foreL, `${neg}ForeArm`], [armR, `${pos}Arm`], [foreR, `${pos}ForeArm`],
    [hipL, `${neg}UpLeg`], [kneeL, `${neg}Leg`], [hipR, `${pos}UpLeg`], [kneeR, `${pos}Leg`],
  ]
  const driven = new Map<THREE.Bone, THREE.Object3D>()
  for (const [proxy, name] of map) {
    const b = bone(model, name)
    if (b) driven.set(b, proxy)
  }

  // repouso de cada osso no espaço da raiz (depois de abaixar os braços)
  const bones: THREE.Bone[] = []
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone)
  })
  const rootInv = new THREE.Quaternion()
  const restLocal = new Map<THREE.Bone, THREE.Quaternion>()
  const restRel = new Map<THREE.Bone, THREE.Quaternion>()
  const relOf = (o: THREE.Object3D) => rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()))
  root.getWorldQuaternion(rootInv).invert()
  for (const b of bones) {
    restLocal.set(b, b.quaternion.clone())
    restRel.set(b, relOf(b))
  }
  const hips = bone(model, 'Hips')
  const hipsRest = hips ? hips.position.clone() : null

  const rel = new Map<THREE.Object3D, THREE.Quaternion>()
  const modelRel = new THREE.Quaternion()
  const sync = () => {
    // posição do corpo (balanço, sentar) vai para o quadril
    model.position.y = body.position.y
    root.updateMatrixWorld(true)
    root.getWorldQuaternion(rootInv).invert()
    modelRel.copy(relOf(model))
    rel.clear()
    // ossos em ordem pai -> filho (traverse já é assim)
    for (const b of bones) {
      // pai que não é osso (nó Armature, às vezes girado/escalado): orientação real dele no espaço da raiz
      const parentRel = b.parent && rel.has(b.parent) ? rel.get(b.parent)! : b.parent ? relOf(b.parent) : modelRel
      const proxy = driven.get(b)
      let local: THREE.Quaternion
      if (proxy) {
        const delta = relOf(proxy)
        const target = delta.multiply(restRel.get(b)!)
        local = parentRel.clone().invert().multiply(target)
      } else local = restLocal.get(b)!.clone()
      b.quaternion.copy(local)
      rel.set(b, parentRel.clone().multiply(local))
    }
    if (hips && hipsRest) hips.position.copy(hipsRest)
  }
  // cabeça 2x maior (escala no osso: a malha da cabeça e o que estiver preso nela crescem juntos)
  const headBone = bone(model, 'Head')
  if (headBone) headBone.scale.setScalar(HEAD_SCALE)
  sync()
  return { root, body, upper, armL, armR, foreL, foreR, head, hipL, hipR, kneeL, kneeR, lens, sync }
}
