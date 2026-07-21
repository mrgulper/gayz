import bpy
import os
import math

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, "weapons/melee-pack/MeleeWeaponsPack#1")
OUT_DIR = os.path.join(BASE, "props")

# Stage 3 of the Extended Metropolitan Grid plan - static display props for
# the Hardware Store, reusing the same 3dmodelscc0 melee weapons pack
# already downloaded for the bat/machete/uvbaton viewmodels (build-melee.py)
# - just a different 3 items from that same folder, and no Grip empty since
# these are shelf/rack decoration, not equippable. Same texture-linking
# function as build-melee.py since this pack's FBX import doesn't auto-link
# its own separately-shipped PBR textures.
ITEMS = [
    {"folder": "Hammer", "src": "Hammer.fbx", "out": "tool-hammer", "rotate_axis": "X", "rotate_deg": 90, "scale": 1.0},
    {"folder": "Crowbar", "src": "Crowbar.fbx", "out": "tool-crowbar", "rotate_axis": "X", "rotate_deg": 90, "scale": 1.0},
    {"folder": "TireIron", "src": "TireIron.fbx", "out": "tool-tireiron", "rotate_axis": "X", "rotate_deg": 90, "scale": 1.0},
    {"folder": "FireAxe", "src": "FireAxe.fbx", "out": "tool-fireaxe", "rotate_axis": "X", "rotate_deg": 90, "scale": 1.0},
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


for item in ITEMS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC_DIR, item["folder"], item["src"]))
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")

    for slot in mesh.material_slots:
        if slot.material:
            link_textures(slot.material, item["folder"], item["folder"])

    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.transform.rotate(value=math.radians(item["rotate_deg"]), orient_axis=item["rotate_axis"])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mesh.select_set(False)

    # Multiply, don't overwrite - see build-melee.py's note on why (the FBX
    # importer already set mesh.scale to compensate for this pack's raw
    # geometry being modeled ~100x too large).
    mesh.scale = (mesh.scale.x * item["scale"], mesh.scale.y * item["scale"], mesh.scale.z * item["scale"])
    mesh.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mesh.select_set(False)

    corners = [mesh.matrix_world @ __import__("mathutils").Vector(c) for c in mesh.bound_box]
    xs = [c.x for c in corners]; ys = [c.y for c in corners]; zs = [c.z for c in corners]
    print(f"{item['out']}: bounds x=({min(xs):.3f},{max(xs):.3f}) y=({min(ys):.3f},{max(ys):.3f}) z=({min(zs):.3f},{max(zs):.3f})")

    out_path = os.path.join(OUT_DIR, f"{item['out']}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
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
