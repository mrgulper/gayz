import bpy
import math
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, "weapons/melee-pack/MeleeWeaponsPack#1")
OUT_DIR = os.path.join(BASE, "weapons")

# Unlike the gun pack (flat colors baked into the material, no separate
# texture files), this pack ships real PBR textures per weapon that the
# base FBX import does NOT auto-link (confirmed via inspection - materials
# import as a single flat "Mat" slot with no image node). Loading and
# wiring Base Color/Normal/Roughness/Metallic here is what makes these
# actually look like the detailed studio-render previews instead of a
# flat grey blob.
WEAPONS = [
    {
        "folder": "Combat_Knife", "src": "Combat_Knife.fbx", "out": "knife",
        "rotate_axis": "X", "rotate_deg": 90, "scale": 1.5,
        "grip": (0, 0.06, 0), "handle_axis": "X",
    },
    {
        "folder": "NailBat", "src": "NailBat.fbx", "out": "bat",
        "rotate_axis": "X", "rotate_deg": 90, "scale": 0.66,
        "grip": (0, 0.1, 0), "handle_axis": "X",
    },
    {
        "folder": "Machete", "src": "Machete.fbx", "out": "machete",
        "rotate_axis": "Z", "rotate_deg": -90, "scale": 1.07,
        "grip": (0, 0.06, 0), "handle_axis": "X",
    },
    {
        "folder": "PoliceBaton", "src": "PoliceBaton.fbx", "out": "baton",
        "rotate_axis": "X", "rotate_deg": 90, "scale": 0.85,
        "grip": (0, 0.06, 0), "handle_axis": "X",
        "tip": (0, -0.32, 0),
    },
]


def link_textures(mat, folder, base_name):
    if not mat.use_nodes:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return

    def load(suffix, colorspace=None):
        path = os.path.join(SRC_DIR, folder, f"{base_name}_{suffix}.png")
        if not os.path.exists(path):
            return None
        img = bpy.data.images.load(path)
        if colorspace:
            img.colorspace_settings.name = colorspace
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = img
        return tex

    base_color = load("Base_Color")
    if base_color:
        links.new(base_color.outputs["Color"], bsdf.inputs["Base Color"])

    roughness = load("Roughness", "Non-Color")
    if roughness:
        links.new(roughness.outputs["Color"], bsdf.inputs["Roughness"])

    metallic = load("Metallic", "Non-Color")
    if metallic:
        links.new(metallic.outputs["Color"], bsdf.inputs["Metallic"])

    normal_tex = load("Normal", "Non-Color") or load("Normal_DirectX", "Non-Color")
    if normal_tex:
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(normal_tex.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])


for w in WEAPONS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC_DIR, w["folder"], w["src"]))
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")

    for slot in mesh.material_slots:
        if slot.material:
            link_textures(slot.material, w["folder"], w["folder"])

    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.transform.rotate(value=math.radians(w["rotate_deg"]), orient_axis=w["rotate_axis"])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mesh.select_set(False)

    # Empties in the already-rotated (pre-scale) space - Grip for
    # attachHandToGrip, Tip (baton only) for the procedural UV-lens prop
    # that stays a separate emissive attachment rather than a real modeled
    # part (this pack has no lit sci-fi baton).
    empties = []
    grip = bpy.data.objects.new("Grip", None)
    grip.location = w["grip"]
    bpy.context.collection.objects.link(grip)
    empties.append(grip)
    if "tip" in w:
        tip = bpy.data.objects.new("Tip", None)
        tip.location = w["tip"]
        bpy.context.collection.objects.link(tip)
        empties.append(tip)

    # Multiply, don't overwrite - the FBX importer already set mesh.scale
    # (e.g. 0.01) to compensate for this pack's raw geometry being modeled
    # ~100x too large; replacing that instead of multiplying it away
    # produced a mesh 50-150x too big the first time this ran.
    for obj in [mesh] + empties:
        obj.scale = (obj.scale.x * w["scale"], obj.scale.y * w["scale"], obj.scale.z * w["scale"])
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)

    corners = [mesh.matrix_world @ __import__("mathutils").Vector(c) for c in mesh.bound_box]
    xs = [c.x for c in corners]; ys = [c.y for c in corners]; zs = [c.z for c in corners]
    print(f"{w['out']}: post-correction bounds x=({min(xs):.3f},{max(xs):.3f}) y=({min(ys):.3f},{max(ys):.3f}) z=({min(zs):.3f},{max(zs):.3f})")

    out_path = os.path.join(OUT_DIR, f"{w['out']}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    for e in empties:
        e.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",
    )
    print("Exported:", out_path)
