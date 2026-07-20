import bpy
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "props")

# All already correctly scaled/oriented on import (same pack pipeline as
# build-props.py's barrel/fuelcan) - no rotation or scale correction
# needed, just texture linking. Any facing-direction fixup (e.g. the
# bench's long axis landing on Z instead of X) is handled at placement
# time in World.js with a simple rotation.y, not baked in here, since
# that's just a yaw and easy to eyeball/adjust without re-exporting.
ITEMS = [
    {"name": "bench", "dir": "city-env-1/CityEnvPack1/StreetBench", "src": "StreetBench.fbx", "tex": "StreetBench"},
    {"name": "dumpster", "dir": "city-env-1/CityEnvPack1/Dumpster", "src": "Dumpster.fbx", "tex": "Dumpster"},
    {"name": "trafficcone", "dir": "city-env-1/CityEnvPack1/Traffic_Cone", "src": "Traffic_Cone.fbx", "tex": "Traffic_Cone"},
    {"name": "roadblock", "dir": "city-env-1/CityEnvPack1/ConcreteRoadblock", "src": "RoadBlock.fbx", "tex": "RoadBlock"},
    {"name": "atm", "dir": "city-env-1/CityEnvPack1/ATM", "src": "ATM.fbx", "tex": "ATM"},
    {"name": "mailbox", "dir": "city-env-1/CityEnvPack1/CityMailBox", "src": "CityMailBox.fbx", "tex": "CityMailBox"},
    {"name": "payphone", "dir": "city-env-1/CityEnvPack1/Payphone", "src": "Payphone.fbx", "tex": "Payphone"},
    {"name": "busstop", "dir": "city-env-2/CityEnviroinmentPack2/Bus_Stop", "src": "Bus_Stop.fbx", "tex": "Bus_Stop"},
    {"name": "trashbin", "dir": "city-env-2/CityEnviroinmentPack2/Plastic_Trash_Bin", "src": "PlasticTrashBin.fbx", "tex": "PlasticTrashBin"},
    {"name": "waterbarrel", "dir": "industrial/IndustrialPack/Water_Barrel", "src": "Water_Barrel.fbx", "tex": "Water_Barrel"},
    {"name": "cabledrum", "dir": "industrial/IndustrialPack/CableDrum", "src": "CableDrum.fbx", "tex": "CableDrum"},
]


def link_textures(mat, tex_dir, base_name):
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


for item in ITEMS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src_dir = os.path.join(BASE, "props", item["dir"])
    bpy.ops.import_scene.fbx(filepath=os.path.join(src_dir, item["src"]))

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for mesh in meshes:
        # Some of this pack's earlier/rougher items (e.g. the trash bin)
        # import with zero material slots at all - nothing for
        # link_textures to attach to, even though the texture files exist.
        # Create one so it still gets the real Base Color/Normal/etc
        # instead of silently exporting with the GLTF exporter's flat
        # default material.
        if len(mesh.material_slots) == 0:
            mat = bpy.data.materials.new(name=f"{item['tex']}_Mat")
            mesh.data.materials.append(mat)
        for slot in mesh.material_slots:
            if slot.material:
                link_textures(slot.material, src_dir, item["tex"])

    corners = []
    for mesh in meshes:
        corners += [mesh.matrix_world @ __import__("mathutils").Vector(c) for c in mesh.bound_box]
    xs = [c.x for c in corners]; ys = [c.y for c in corners]; zs = [c.z for c in corners]
    print(f"{item['name']}: bounds x=({min(xs):.3f},{max(xs):.3f}) y=({min(ys):.3f},{max(ys):.3f}) z=({min(zs):.3f},{max(zs):.3f})")

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
