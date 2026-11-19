# dmgbuild settings, called from tools/build_release.sh:
#   dmgbuild -s tools/dmg/settings.py -D stage=DIR -D res=DIR "Claude in Safari" OUT.dmg
import os

stage = defines["stage"]  # noqa: F821
res = defines["res"]  # noqa: F821

format = "UDZO"
filesystem = "HFS+"
files = [os.path.join(stage, n) for n in ("Sign with my certificate.app", "Claude in Safari.app", "Claude Safari Server", "README.txt")]
symlinks = {"Applications": "/Applications"}
hide_extensions = ["Sign with my certificate.app", "Claude in Safari.app"]
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
    "Sign with my certificate.app": (120, 160),
    "Claude in Safari.app": (92, 292),
    "Applications": (192, 292),
    "Claude Safari Server": (120, 424),
    "README.txt": (120, 530),
}
