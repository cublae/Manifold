{
  description = "Manifold — a desktop shell for the niri compositor, built on AGS and GTK4";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # AGS v3 is not in nixpkgs, so the CLI and its JS library come from
    # upstream. The Astal *libraries* still come from nixpkgs: they are built
    # against the same glib and gtk4 as everything else here, and the bundler
    # only cares that the Astal 4.0 typelib is on GI_TYPELIB_PATH at runtime.
    ags = {
      url = "github:Aylur/ags/v3.1.2";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, nixpkgs, ags }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            inherit system;
            pkgs = nixpkgs.legacyPackages.${system};
          }
        );
    in
    {
      packages = forAllSystems (
        { pkgs, ... }:
        let
          manifold = pkgs.callPackage ./nix/package.nix { ags = ags.packages.${pkgs.stdenv.hostPlatform.system}.default; };
        in
        {
          inherit manifold;
          default = manifold;
        }
      );

      devShells = forAllSystems (
        { pkgs, ... }:
        let
          inherit (pkgs) lib astal;
          agsCli = ags.packages.${pkgs.stdenv.hostPlatform.system}.default;

          # Everything providing a typelib the shell imports through `gi://`.
          # `ags run` resolves these from the ambient environment rather than
          # from a wrapper, so this list must track nix/package.nix.
          giPackages = [
            pkgs.gtk4
            pkgs.libadwaita
            pkgs.gdk-pixbuf
            pkgs.libsoup_3
            pkgs.gtk4-layer-shell
            pkgs.glib
            astal.astal4
            astal.io
            astal.battery
            astal.network
            astal.wireplumber
            pkgs.networkmanager
            pkgs.glib-networking
            pkgs.dconf
            astal.tray
            astal.bluetooth
            astal.brightness
            astal.notifd
            astal.apps
            astal.mpris
            astal.powerprofiles
          ];

          # Directories holding the GIR XML the type generator reads.
          #
          # Not the same thing as a typelib: `ags types` needs the source XML,
          # which lives in `share/gir-1.0` -- in the `dev` output for anything
          # that has one. Without these, `npm run typecheck` cannot resolve a
          # single `gi://` import and reports hundreds of errors that hide the
          # real ones.
          girPackages =
            giPackages
            ++ [
              pkgs.gtk4.dev
              pkgs.glib.dev
              pkgs.gdk-pixbuf.dev
              pkgs.libadwaita.dev
              pkgs.libsoup_3.dev
              pkgs.networkmanager.dev
              pkgs.pango.dev
              pkgs.graphene.dev
              pkgs.harfbuzz.dev
              pkgs.at-spi2-core.dev
            ];

          girPath = lib.concatMapStringsSep ":" (p: "${p}/share") (
            lib.filter (p: builtins.pathExists "${p}/share/gir-1.0") girPackages
          );

          # Packages shipping GSettings schemas. AstalNotifd and AstalApps read
          # their settings through GSettings and abort outright when the schema
          # is missing, so the schemas have to be on XDG_DATA_DIRS.
          schemaPackages = [
            pkgs.gsettings-desktop-schemas
            pkgs.glib-networking
            pkgs.dconf
            pkgs.gtk4
            astal.notifd
          ];

          schemaPath = lib.concatMapStringsSep ":" (
            p: "${p}/share/gsettings-schemas/${p.name}"
          ) schemaPackages;
        in
        {
          default = pkgs.mkShell {
            name = "manifold-dev";

            # Populates GI_TYPELIB_PATH from buildInputs.
            nativeBuildInputs = [ pkgs.gobject-introspection ];

            packages = [
              # `ags run`, `ags bundle`, `ags types` — v3 from upstream
              agsCli

              # SCSS compilation, both in-build and for the dev-mode watcher
              pkgs.dart-sass

              # `npm run typecheck`
              pkgs.nodejs
              pkgs.typescript

              pkgs.gjs
            ];

            buildInputs = giPackages;

            shellHook = ''
              export XDG_DATA_DIRS="${schemaPath}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"

              # tsconfig resolves "ags/*" through ./node_modules/ags. Link the AGS
              # JS library out of the store so typechecking and editor tooling
              # can find it without a package manager.
              mkdir -p node_modules
              ln -sfn ${agsCli}/share/ags/js node_modules/ags

              # Where the type generator looks for GIR XML. `ags types` runs
              # ts-for-gir with its own baked-in data dirs, which cover GTK and
              # not much else, so the rest is generated by calling ts-for-gir
              # directly -- see `npm run types`.
              export MANIFOLD_GIR_PATH="${girPath}"

              echo "Manifold dev shell"
              echo "  npm run dev        — run the shell against this checkout"
              echo "  npm run typecheck  — typecheck without building"
              echo "  npm run types      — regenerate the @girs stubs"
            '';
          };
        }
      );

      homeManagerModules = {
        manifold = import ./modules/home-manager.nix self;
        default = self.homeManagerModules.manifold;
      };

      overlays.default = final: prev: {
        manifold = final.callPackage ./nix/package.nix { ags = ags.packages.${final.stdenv.hostPlatform.system}.default; };
      };

      formatter = forAllSystems ({ pkgs, ... }: pkgs.nixfmt-rfc-style);
    };
}
