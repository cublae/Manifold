{
  lib,
  stdenvNoCC,
  ags,
  astal,
  gjs,
  dart-sass,
  gobject-introspection,
  wrapGAppsHook3,
  gtk4-layer-shell,
  glib,
  gsettings-desktop-schemas,
  wl-clipboard,
  cliphist,
  coreutils,
  gnugrep,
  procps,
  glib-networking,
  dconf,
  gdk-pixbuf,
  libsoup_3,
  networkmanager,
  libadwaita,
}:

# Manifold is bundled by AGS: `ags bundle` runs esbuild over the TypeScript and
# dart-sass over the SCSS, emitting a single self-contained GJS script.
#
# The `ags` CLI is AGS v3 from upstream, since nixpkgs only carries v2. The
# Astal *libraries* still come from nixpkgs so they are built against the same
# glib and gtk4 as the rest of this closure; the bundler never links against
# them, it only needs the Astal 4.0 typelib present at runtime.
#
# Every `gi://` import in src/ must have a provider in `buildInputs`, or the
# shell dies at startup with "Requiring <Namespace>: Typelib not found".

stdenvNoCC.mkDerivation {
  pname = "manifold";
  version = "0.1.0";

  # Filter the tree before it enters the store. `node_modules` is a symlink
  # into the store (created by the dev shell) and `result` is a build symlink;
  # copying either makes the derivation depend on unrelated paths, and a stale
  # one fails the dangling-symlink check.
  src = lib.cleanSourceWith {
    src = ../.;
    name = "manifold-source";
    filter =
      path: _type:
      let
        base = baseNameOf path;
      in
      !(builtins.elem base [
        "node_modules"
        "@girs"
        "dist"
        ".direnv"
        ".git"
      ])
      && !(lib.hasPrefix "result" base);
  };

  nativeBuildInputs = [
    wrapGAppsHook3
    gobject-introspection
    ags
  ];

  buildInputs = [
    gjs

    # gi://Astal — layer-shell windows and the widget toolkit
    astal.astal4
    astal.io

    # gi://Adw — named colours, light/dark, the Adwaita stylesheet
    libadwaita

    # gi://GdkPixbuf — decoding the wallpaper for the accent colour. Pulled in
    # by gtk4 anyway; named here because every gi:// import needs a provider.
    gdk-pixbuf

    # gi://AstalBattery, AstalNetwork, AstalWp — bar system indicators.
    # AstalNetwork needs NM-1.0 transitively, which networkmanager provides.
    astal.battery
    astal.network
    networkmanager
    astal.wireplumber

    # gi://AstalTray — системный трей (StatusNotifierItem)
    astal.tray

    # gi://AstalBluetooth, AstalBrightness — переключатели control center
    astal.bluetooth
    astal.brightness

    # gi://AstalNotifd — демон уведомлений freedesktop
    astal.notifd

    # gi://AstalApps — индекс .desktop-файлов для лаунчера
    astal.apps

    # gi://AstalMpris, AstalPowerProfiles — медиаплеер и профили питания в CC
    astal.mpris
    astal.powerprofiles

    # AstalApps читает настройки через GSettings и падает без установленных схем
    glib
    gsettings-desktop-schemas

    # gi://Soup — the weather module's HTTPS client. Paired with
    # glib-networking below, which is what gives it TLS.
    libsoup_3

    # GIO TLS backend. Without it AstalMpris cannot fetch cover art over https
    # and every download fails with "TLS support is not available".
    glib-networking

    # GSettings backend, so settings such as do-not-disturb actually persist.
    dconf
  ];

  preFixup = ''
    gappsWrapperArgs+=(
      # The style watcher shells out to sass; the clipboard service to cliphist,
      # wl-paste and pkill.
      --prefix PATH : ${lib.makeBinPath [ dart-sass wl-clipboard cliphist coreutils gnugrep procps ]}

      # Astal.Window only becomes a layer-shell surface under GTK4 when
      # gtk4-layer-shell is preloaded ahead of libgtk.
      --set LD_PRELOAD "${gtk4-layer-shell}/lib/libgtk4-layer-shell.so"
    )
  '';

  # esbuild resolves everything from the source tree; there is nothing to
  # compile ahead of the bundle step.
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/share/manifold
    cp -r ./* $out/share/manifold

    ags bundle src/app.ts $out/bin/manifold --gtk 4 -d "SRC='$out/share/manifold'"
    chmod +x $out/bin/manifold

    # `ags bundle` does not always emit a shebang; without one the wrapper has
    # nothing to exec.
    if ! head -n 1 "$out/bin/manifold" | grep -q '^#!'; then
      sed -i '1i #!${gjs}/bin/gjs -m' "$out/bin/manifold"
    fi

    runHook postInstall
  '';

  meta = {
    description = "A desktop shell for the niri compositor, built on AGS and GTK4";
    mainProgram = "manifold";
    platforms = lib.platforms.linux;
    license = lib.licenses.mit;
  };
}
