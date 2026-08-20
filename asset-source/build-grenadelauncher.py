import bpy
import math
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "weapons", "grenadelauncher.glb")
BAKE_SIZE = 1024

METAL_BASE_COLOR = (0.045, 0.045, 0.05, 1.0)
DARK_METAL_BASE_COLOR = (0.025, 0.025, 0.028, 1.0)
WOOD_BASE_COLOR = (0.09, 0.06, 0.045, 1.0)
GRIP_BASE_COLOR = (0.055, 0.038, 0.026, 1.0)

# Converts this game's own Three.js position convention (X=width,
# Y=up, Z=forward with muzzle at -Z, matching buildGrenadeLauncher in
# Viewmodels.js) directly into Blender space, so export_yup produces
# the exact right orientation with no post-import rotate-correction
# needed (that dance was only ever for compensating an imported FBX
# pack's own foreign axes, not something export_yup itself requires).
def T(x, y, z):
    return (x, -z, y)


def make_material(name, base_color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_box(name, size, pos, rot, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("Bevel", type='BEVEL')
    bevel.width = min(size) * 0.06
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    return obj


def add_cylinder(name, radius, depth, pos, rot, mat):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=16, location=pos)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    bevel = obj.modifiers.new("Bevel", type='BEVEL')
    bevel.width = radius * 0.12
    bevel.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="Bevel")
    obj.data.materials.append(mat)
    return obj


def add_wear_and_bake(mesh):
    """Same proven recipe as texture-pistol.py / texture-remaining-guns.py."""
    bpy.context.view_layer.objects.active = mesh
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    bake_targets = []
    for slot in mesh.material_slots:
        mat = slot.material
        if not mat:
            continue
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        base_color = bsdf.inputs["Base Color"].default_value[:]
        base_rough = bsdf.inputs["Roughness"].default_value

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
        base_col_node.outputs[0].default_value = base_color
        nt.links.new(base_col_node.outputs[0], dark_col.inputs["A"])
        nt.links.new(pointiness_ramp.outputs["Color"], dark_col.inputs["B"])
        nt.links.new(dark_col.outputs[0], bsdf.inputs["Base Color"])

        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.15
        nt.links.new(noise_fine.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

        img_base = bpy.data.images.new(f"{mesh.name}_{mat.name}_BaseColor", BAKE_SIZE, BAKE_SIZE)
        img_rough = bpy.data.images.new(f"{mesh.name}_{mat.name}_Roughness", BAKE_SIZE, BAKE_SIZE, is_data=True)
        img_norm = bpy.data.images.new(f"{mesh.name}_{mat.name}_Normal", BAKE_SIZE, BAKE_SIZE, is_data=True)
        img_norm.colorspace_settings.name = 'Non-Color'
        img_rough.colorspace_settings.name = 'Non-Color'

        bake_node = nt.nodes.new("ShaderNodeTexImage")
        for n in nt.nodes:
            n.select = False
        bake_node.select = True
        nt.nodes.active = bake_node
        bake_targets.append((mat, nt, bake_node, img_base, img_rough, img_norm))

    if not bake_targets:
        return

    bpy.context.view_layer.objects.active = mesh
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)

    for _, _, bake_node, img_base, _, _ in bake_targets:
        bake_node.image = img_base
    bpy.context.scene.render.bake.use_pass_direct = False
    bpy.context.scene.render.bake.use_pass_indirect = False
    bpy.ops.object.bake(type='DIFFUSE')

    for _, _, bake_node, _, img_rough, _ in bake_targets:
        bake_node.image = img_rough
    bpy.ops.object.bake(type='ROUGHNESS')

    for _, _, bake_node, _, _, img_norm in bake_targets:
        bake_node.image = img_norm
    bpy.ops.object.bake(type='NORMAL')

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


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.device = 'CPU'
bpy.context.scene.cycles.samples = 32

mat_metal = make_material("Metal", METAL_BASE_COLOR, 1.0, 0.35)
mat_dark_metal = make_material("DarkMetal", DARK_METAL_BASE_COLOR, 1.0, 0.4)
mat_wood = make_material("Wood", WOOD_BASE_COLOR, 0.0, 0.55)
mat_grip = make_material("Grip", GRIP_BASE_COLOR, 0.0, 0.75)

# Exact dimensions/positions from Viewmodels.js buildGrenadeLauncher(), so
# the bob/sway/recoil calibration (tuned around those numbers) still feels
# right with this geometry swapped in underneath it.
body = add_box("Body", (0.09, 0.1, 0.22), T(0, 0.02, 0.02), (0, 0, 0), mat_dark_metal)
barrel = add_cylinder("Barrel", 0.038, 0.24, T(0, 0.02, -0.22), (math.radians(90), 0, 0), mat_metal)
drum = add_cylinder("Drum", 0.065, 0.07, T(0, -0.09, 0.0), (math.radians(90), 0, 0), mat_dark_metal)
stock = add_box("Stock", (0.055, 0.09, 0.16), T(0, -0.01, 0.22), (0, 0, 0), mat_wood)
grip = add_box("GripMesh", (0.055, 0.14, 0.07), T(0, -0.09, 0.1), (-0.25, 0, 0), mat_grip)
foregrip = add_box("Foregrip", (0.05, 0.06, 0.06), T(0, -0.03, -0.16), (0, 0, 0), mat_grip)

parts = [body, barrel, drum, stock, grip, foregrip]
for p in parts:
    add_wear_and_bake(p)

grip_empty = bpy.data.objects.new("Grip", None)
grip_empty.location = T(0, -0.09, 0.1)
bpy.context.collection.objects.link(grip_empty)
foregrip_empty = bpy.data.objects.new("Foregrip", None)
foregrip_empty.location = T(0, -0.03, -0.16)
bpy.context.collection.objects.link(foregrip_empty)
muzzle_empty = bpy.data.objects.new("Muzzle", None)
muzzle_empty.location = T(0, 0.02, -0.34)
bpy.context.collection.objects.link(muzzle_empty)

bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
grip_empty.select_set(True)
foregrip_empty.select_set(True)
muzzle_empty.select_set(True)
bpy.context.view_layer.objects.active = body

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
print("Exported:", OUT)
