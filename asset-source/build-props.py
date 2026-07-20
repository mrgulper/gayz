import bpy
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "props")

# Unlike the weapon packs, none of these three need a corrective rotation -
# they're all already modeled Z-up in Blender with no unusual axis choice,
# so export_yup handles the Blender-Z -> Three.js-Y remap correctly on its
# own. Only a scale correction (and texture linking, same as the melee
# weapons pack) is needed per item.
ITEMS = [
    {
        "name": "barrel",
        "src_dir": os.path.join(BASE, "props/industrial/IndustrialPack/ExplosiveBarrel"),
        "src_file": "ExplosiveBarrel.fbx",
        "tex_base": "ExplosiveBarrel",
        "importer": "fbx",
        "scale": 1.0,  # already close to real-world size (see inspection)
    },
    {
        "name": "fuelcan",
        "src_dir": os.path.join(BASE, "props/industrial/IndustrialPack/Gas_can"),
        "src_file": "Gas_Canister.fbx",
        "tex_base": "GasCan",
        "importer": "fbx",
        "scale": 1.0,
    },
    {
        "name": "streetlight",
        "src_dir": os.path.join(BASE, "props/city-env-1/CityEnvPack1/StreetLight"),
        "src_file": "StreetLight.obj",
        "tex_base": "StreetLight",
        "importer": "obj",
        "scale": 0.0123,  # raw model ~447 units tall, target ~5.5
        "has_emissive": True,
    },
]


def link_textures(mat, tex_dir, base_name, has_emissive=False):
    if not mat.use_nodes:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return

    def load(suffix, colorspace=None):
        path = os.path.join(tex_dir, f"{base_name}_{suffix}.png")
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

    if has_emissive:
        emissive = load("Emissive")
        if emissive:
            links.new(emissive.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 3.0


for item in ITEMS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src_path = os.path.join(item["src_dir"], item["src_file"])
    if item["importer"] == "fbx":
        bpy.ops.import_scene.fbx(filepath=src_path)
    else:
        bpy.ops.wm.obj_import(filepath=src_path)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for mesh in meshes:
        for slot in mesh.material_slots:
            if slot.material:
                link_textures(slot.material, item["src_dir"], item["tex_base"], item.get("has_emissive", False))

    for obj in meshes:
        obj.scale = (obj.scale[0] * item["scale"], obj.scale[1] * item["scale"], obj.scale[2] * item["scale"])
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)

    corners = []
    for mesh in meshes:
        corners += [mesh.matrix_world @ __import__("mathutils").Vector(c) for c in mesh.bound_box]
    xs = [c.x for c in corners]; ys = [c.y for c in corners]; zs = [c.z for c in corners]
    print(f"{item['name']}: post-correction bounds x=({min(xs):.3f},{max(xs):.3f}) y=({min(ys):.3f},{max(ys):.3f}) z=({min(zs):.3f},{max(zs):.3f})")

    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    out_path = os.path.join(OUT_DIR, f"{item['name']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",
    )
    print("Exported:", out_path)
