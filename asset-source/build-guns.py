import bpy
import math
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, "weapons/quaternius-guns/FBX")
OUT_DIR = os.path.join(BASE, "weapons")

# Same pack, same convention as the pistol (asset-source/build-pistol.py) -
# muzzle at +X, thin along Y, tall along Z in the raw import. Each entry:
# source file, output name, corrective scale (raw model's forward-axis
# extent -> this game's own procedural equivalent's real target length,
# same empirical-measurement approach used throughout this project), and
# the Grip empty's position in the ALREADY-SCALED target space (copied
# from each procedural builder's own grip.position in Viewmodels.js).
WEAPONS = [
    {
        "src": "AssaultRifle_1.fbx", "out": "rifle",
        "scale": 0.335, "grip": (0, -0.09, 0.1), "foregrip": (0, -0.08, -0.32),
    },
    {
        "src": "Shotgun_1.fbx", "out": "shotgun",
        "scale": 0.159, "grip": (0, -0.09, 0.11), "foregrip": (0, -0.01, -0.14),
    },
    {
        "src": "SniperRifle_1.fbx", "out": "awp",
        "scale": 0.162, "grip": (0, -0.09, 0.14), "foregrip": (0, -0.075, -0.34),
    },
    {
        "src": "Pistol_2.fbx", "out": "glock18",
        "scale": 0.190, "grip": (0, -0.075, 0.07),
    },
]

for w in WEAPONS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC_DIR, w["src"]))
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")

    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mesh.select_set(False)

    grip = bpy.data.objects.new("Grip", None)
    grip.location = w["grip"]
    bpy.context.collection.objects.link(grip)

    extra_empties = [grip]
    if "foregrip" in w:
        foregrip = bpy.data.objects.new("Foregrip", None)
        foregrip.location = w["foregrip"]
        bpy.context.collection.objects.link(foregrip)
        extra_empties.append(foregrip)

    for obj in [mesh] + extra_empties:
        obj.scale = (w["scale"], w["scale"], w["scale"])
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)

    print(f"{w['out']}: materials =", [s.material.name for s in mesh.material_slots if s.material])

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    for e in extra_empties:
        e.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    out_path = os.path.join(OUT_DIR, f"{w['out']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    print("Exported:", out_path)
