import bpy
import os
import math

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "props")

# Bespoke Blender-modeled replacements for the Vault and Ammo Station
# (Phase 5's remaining "no good free pack fits" interactables - see
# 3D_ASSET_OVERHAUL.md's Blender-scripting fallback method). Proportions
# match the procedural versions in Chests.js/World.js exactly so gameplay
# code (door swing, button glow) keeps working unchanged; only the visual
# geometry/materials are upgraded.
#
# Deliberately NO parent/child relationships here - Blender's glTF exporter
# combined with export_apply produced garbage transforms (huge bogus scale
# like 33x) on manually-parented children in an earlier attempt. Instead
# every object is exported flat, in its own final world-space position, and
# any object that needs to move together at runtime (the vault door's dial/
# handle) gets reparented in JS via THREE's Object3D.attach(), which does
# the world-transform-preserving math correctly on the Three.js side.
#
# Axis convention: author in Blender's Z-up, export_yup=True remaps
# Blender Z->Three Y, Blender Y->Three Z, Blender X stays X - so a Three
# dimension (w, h, d) is authored here as Blender (x=w, y=d, z=h).


def new_mat(name, color, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def box(name, mat, size, location, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    obj.data.materials.append(mat)
    return obj


def cylinder(name, mat, radius, depth, location, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def export(objects, out_path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    print("Exported:", out_path)


# ---------------------------------------------------------------- VAULT ----
def build_vault():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    W, H, D = 1.1, 1.3, 0.9  # Three (width, height, depth)
    half_d = D / 2

    body_mat = new_mat("VaultBody", (0.19, 0.20, 0.22), roughness=0.45, metallic=0.65)
    trim_mat = new_mat("VaultTrim", (0.07, 0.075, 0.08), roughness=0.4, metallic=0.7)
    dial_mat = new_mat("VaultDial", (0.72, 0.66, 0.24), roughness=0.3, metallic=0.8)

    # Blender Y maps to Three -Z on export (export_yup), so everything on
    # the door face is authored at NEGATIVE Blender-Y here to land at
    # POSITIVE Three-Z - matching the old procedural door's +half convention
    # so open()'s "door.position.z += 0.35" swings it further out from the
    # body instead of back into it.
    body = box("Body", body_mat, (W, D, H), (0, 0, H / 2))
    rim = box("Rim", trim_mat, (W - 0.06, 0.02, H - 0.06), (0, -(half_d + 0.005), H / 2))

    door_y = -(half_d + 0.03)
    door = box("Door", trim_mat, (W - 0.1, 0.06, H - 0.1), (0, door_y, H / 2))
    dial = cylinder("Dial", dial_mat, 0.13, 0.05, (0.15, door_y - 0.07, H / 2 + 0.1), rotation=(math.pi / 2, 0, 0))

    notches = []
    for i in range(8):
        ang = i * math.pi / 4
        nx = 0.15 + 0.15 * math.cos(ang)
        nz = (H / 2 + 0.1) + 0.15 * math.sin(ang)
        notches.append(box(f"DialNotch{i}", trim_mat, (0.024, 0.02, 0.024), (nx, door_y - 0.07, nz)))

    handle = box("Handle", trim_mat, (0.05, 0.05, 0.35), (-0.28, door_y - 0.07, H / 2 - 0.05))

    export([body, rim, door, dial, handle] + notches, os.path.join(OUT_DIR, "vault.glb"))


# --------------------------------------------------------- AMMO STATION ----
def build_ammo_station():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    W, H, D = 0.7, 1.1, 0.5

    body_mat = new_mat("AmmoBody", (0.35, 0.16, 0.12), roughness=0.6, metallic=0.25)
    trim_mat = new_mat("AmmoTrim", (0.11, 0.11, 0.1), roughness=0.45, metallic=0.55)
    button_mat = new_mat("AmmoButton", (0.16, 0.05, 0.05), roughness=0.4, metallic=0.1)
    button_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.16, 0.12, 1.0)
    button_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 1.1

    # Same Blender-Y -> Three -Z front-face sign flip as the vault door (see
    # build_vault's comment) so the bezel/button land on +Z, matching the
    # procedural canvas-texture screen's old position.
    body = box("Body", body_mat, (W, D, H), (0, 0, H / 2))
    trim = box("Trim", trim_mat, (W + 0.04, D + 0.04, 0.06), (0, 0, H + 0.03))
    bezel = box("Bezel", trim_mat, (0.54, 0.01, 0.42), (0, -(D / 2 + 0.005), 0.65))
    button = cylinder("Button", button_mat, 0.06, 0.04, (0, -(D / 2 + 0.02), 0.28), rotation=(math.pi / 2, 0, 0))

    export([body, trim, bezel, button], os.path.join(OUT_DIR, "ammostation.glb"))


build_vault()
build_ammo_station()
