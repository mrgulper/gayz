import bpy
import math
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "weapons/quaternius-guns/FBX/Pistol_1.fbx")
OUT = os.path.join(BASE, "weapons/pistol_textured.glb")
BAKE_SIZE = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.device = 'CPU'
bpy.context.scene.cycles.samples = 32

bpy.ops.import_scene.fbx(filepath=SRC)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")

bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

grip = bpy.data.objects.new("Grip", None)
grip.location = (0, -0.09, 0.12)
bpy.context.collection.objects.link(grip)
muzzle = bpy.data.objects.new("Muzzle", None)
muzzle.location = (0, 0.02, -0.32)
bpy.context.collection.objects.link(muzzle)

CORRECTION = 0.165
for obj in [mesh, grip, muzzle]:
    obj.scale = (CORRECTION, CORRECTION, CORRECTION)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)

# ---- Real UVs ----
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
bpy.ops.object.mode_set(mode='OBJECT')

METAL_BASE_COLOR = (0.045, 0.045, 0.05, 1.0)
WOOD_BASE_COLOR = (0.09, 0.06, 0.045, 1.0)

# ---- Pass 1: build the procedural wear material + bake target nodes for
# EVERY material first, before any baking happens. Blender bakes all
# materials on a mesh in one shared pass per bake-type call, and needs
# each material's target image node already active+selected going in. ----
bake_targets = []  # (mat, bake_node, img_base, img_rough, img_norm)
for slot in mesh.material_slots:
    mat = slot.material
    if not mat:
        continue
    is_wood = "wood" in mat.name.lower()
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = WOOD_BASE_COLOR if is_wood else METAL_BASE_COLOR
    bsdf.inputs["Metallic"].default_value = 0.0 if is_wood else 1.0
    base_rough = 0.55 if is_wood else 0.35
    bsdf.inputs["Roughness"].default_value = base_rough

    noise_fine = nt.nodes.new("ShaderNodeTexNoise")
    noise_fine.inputs["Scale"].default_value = 40.0
    noise_fine.inputs["Detail"].default_value = 4.0

    noise_streak = nt.nodes.new("ShaderNodeTexNoise")
    noise_streak.inputs["Scale"].default_value = 6.0
    noise_streak.inputs["Detail"].default_value = 2.0

    geo = nt.nodes.new("ShaderNodeNewGeometry")
    pointiness_ramp = nt.nodes.new("ShaderNodeValToRGB")
    pointiness_ramp.color_ramp.elements[0].position = 0.35
    pointiness_ramp.color_ramp.elements[1].position = 0.65

    mix_noise = nt.nodes.new("ShaderNodeMix")
    mix_noise.data_type = 'FLOAT'
    mix_noise.inputs["Factor"].default_value = 0.5

    rough_combine = nt.nodes.new("ShaderNodeMix")
    rough_combine.data_type = 'FLOAT'
    rough_combine.inputs["Factor"].default_value = 0.45

    rough_low = nt.nodes.new("ShaderNodeValue")
    rough_low.outputs[0].default_value = max(0.08, base_rough - 0.28)
    rough_high = nt.nodes.new("ShaderNodeValue")
    rough_high.outputs[0].default_value = min(0.95, base_rough + 0.30)

    nt.links.new(noise_fine.outputs["Fac"], mix_noise.inputs[2])
    nt.links.new(noise_streak.outputs["Fac"], mix_noise.inputs[3])
    nt.links.new(geo.outputs["Pointiness"], pointiness_ramp.inputs["Fac"])
    nt.links.new(mix_noise.outputs[0], rough_combine.inputs["Factor"])
    nt.links.new(rough_low.outputs[0], rough_combine.inputs["A"])
    nt.links.new(rough_high.outputs[0], rough_combine.inputs["B"])
    nt.links.new(rough_combine.outputs[0], bsdf.inputs["Roughness"])

    dark_col = nt.nodes.new("ShaderNodeMix")
    dark_col.data_type = 'RGBA'
    dark_col.blend_type = 'MULTIPLY'
    dark_col.inputs["Factor"].default_value = 0.35
    base_col_node = nt.nodes.new("ShaderNodeRGB")
    base_col_node.outputs[0].default_value = WOOD_BASE_COLOR if is_wood else METAL_BASE_COLOR
    nt.links.new(base_col_node.outputs[0], dark_col.inputs["A"])
    nt.links.new(pointiness_ramp.outputs["Color"], dark_col.inputs["B"])
    nt.links.new(dark_col.outputs[0], bsdf.inputs["Base Color"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    nt.links.new(noise_fine.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    img_base = bpy.data.images.new(f"{mat.name}_BaseColor", BAKE_SIZE, BAKE_SIZE)
    img_rough = bpy.data.images.new(f"{mat.name}_Roughness", BAKE_SIZE, BAKE_SIZE, is_data=True)
    img_norm = bpy.data.images.new(f"{mat.name}_Normal", BAKE_SIZE, BAKE_SIZE, is_data=True)
    img_norm.colorspace_settings.name = 'Non-Color'
    img_rough.colorspace_settings.name = 'Non-Color'

    bake_node = nt.nodes.new("ShaderNodeTexImage")
    for n in nt.nodes:
        n.select = False
    bake_node.select = True
    nt.nodes.active = bake_node

    bake_targets.append((mat, nt, bake_node, img_base, img_rough, img_norm))

# ---- Pass 2: one shared bake call per pass, covering every material at once ----
bpy.context.view_layer.objects.active = mesh
for o in bpy.context.selected_objects:
    o.select_set(False)
mesh.select_set(True)

for mat, nt, bake_node, img_base, img_rough, img_norm in bake_targets:
    bake_node.image = img_base
bpy.context.scene.render.bake.use_pass_direct = False
bpy.context.scene.render.bake.use_pass_indirect = False
bpy.ops.object.bake(type='DIFFUSE')
print("Baked pass: DIFFUSE (base color)")

for mat, nt, bake_node, img_base, img_rough, img_norm in bake_targets:
    bake_node.image = img_rough
bpy.ops.object.bake(type='ROUGHNESS')
print("Baked pass: ROUGHNESS")

for mat, nt, bake_node, img_base, img_rough, img_norm in bake_targets:
    bake_node.image = img_norm
bpy.ops.object.bake(type='NORMAL')
print("Baked pass: NORMAL")

# ---- Pass 3: wire the baked images back in as the real exportable material ----
for mat, nt, bake_node, img_base, img_rough, img_norm in bake_targets:
    bsdf = nt.nodes.get("Principled BSDF")

    tex_base = nt.nodes.new("ShaderNodeTexImage")
    tex_base.image = img_base
    nt.links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])

    tex_rough = nt.nodes.new("ShaderNodeTexImage")
    tex_rough.image = img_rough
    nt.links.new(tex_rough.outputs["Color"], bsdf.inputs["Roughness"])

    tex_norm = nt.nodes.new("ShaderNodeTexImage")
    tex_norm.image = img_norm
    norm_map_node = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex_norm.outputs["Color"], norm_map_node.inputs["Color"])
    nt.links.new(norm_map_node.outputs["Normal"], bsdf.inputs["Normal"])

    bake_node.image = None

# ---- Export ----
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
grip.select_set(True)
muzzle.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print("Exported:", OUT)
