# dmgbuild settings, called from tools/build_release.sh:
#   dmgbuild -s tools/dmg/settings.py -D stage=DIR -D res=DIR -D wizard="Sign with my certificate" "Claude in Safari" OUT.dmg
import os

stage = defines["stage"]  # noqa: F821
res = defines["res"]  # noqa: F821
wizard = defines["wizard"] + ".app"  # noqa: F821  (the wizard's file name depends on the language)

format = "UDZO"
filesystem = "HFS+"
files = [os.path.join(stage, n) for n in (wizard, "Claude in Safari.app", "Claude Safari Server", "README.txt")]
symlinks = {"Applications": "/Applications"}
hide_extensions = [wizard, "Claude in Safari.app"]
background = os.path.join(res, "background.tiff")
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
window_rect = ((200, 80), (660, 668))
default_view = "icon-view"
show_icon_preview = False
icon_size = 80
text_size = 12
arrange_by = None
label_pos = "bottom"
icon_locations = {
    wizard: (120, 160),
    "Claude in Safari.app": (92, 292),
    "Applications": (192, 292),
    "Claude Safari Server": (120, 424),
    "README.txt": (120, 530),
}
