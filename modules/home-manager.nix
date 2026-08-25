# Home Manager module for Manifold.
#
# Usage:
#
#   imports = [ inputs.manifold.homeManagerModules.default ];
#   programs.manifold.enable = true;
#
# Everything under `programs.manifold` that is not `enable`, `package` or
# `systemd` is serialised into ~/.config/manifold/config.json, which is the
# shell's only configuration input. Options left unset are omitted from the
# JSON entirely, so the shell's own defaults apply -- Nix never has to restate
# them, and they cannot drift apart.

self:
{
  config,
  lib,
  options,
  pkgs,
  ...
}:

let
  cfg = config.programs.manifold;
  inherit (lib) mkIf mkOption mkEnableOption types;

  jsonFormat = pkgs.formats.json { };

  /* Drop every null so unset options fall through to the shell defaults. */
  prune = lib.filterAttrsRecursive (_: value: value != null);

  /* Whether niri's own Home Manager module is in the configuration.

     Plenty of people enable the compositor from the system configuration
     instead, where `programs.niri` is never declared on the Home Manager side.
     A definition for an undeclared option is an error even when the `mkIf`
     guarding it is false, so `spawn-at-startup` has to be left out of the
     attribute set entirely rather than merely disabled. */
  hasNiriModule = options ? programs && options.programs ? niri;

  /* Drop sections that came out empty after pruning, so the generated JSON
     contains only what the user actually set. */
  compact =
    attrs:
    lib.filterAttrs (_: v: !(builtins.isAttrs v && v == { })) (
      builtins.mapAttrs (_: v: if builtins.isAttrs v then compact v else v) attrs
    );

  barModule = types.enum [
    "workspaces"
    "focused-window"
    "clock"
    "keyboard-layout"
    "system-indicators"
    "tray"
    "notifications"
    "launcher"
    "clipboard"
    "control-center"
    "media"
    "recording"
    "screencast"
    "privacy"
    "resources"
    "weather"
    "spacer"
  ];

  /* Structured options, before the freeform `settings` are layered on top. */
  generated = prune {
    bar = prune {
      inherit (cfg.bar)
        enable
        position
        size
        onAllMonitors
        ;
      modules = prune { inherit (cfg.bar.modules) start center end; };
      # `prune` above is recursive, so the unset sections inside each output
      # drop out on their own and an output with nothing set disappears with
      # them.
      inherit (cfg.bar) outputs;
    };

    workspaces = prune {
      inherit (cfg.workspaces)
        perMonitor
        showEmpty
        labels
        showIcons
        maxIcons
        ;
    };

    focusedWindow = prune { inherit (cfg.focusedWindow) maxLength showAppId; };

    modules = prune {
      inherit (cfg.modules)
        controlCenter
        notifications
        launcher
        osd
        ;
    };

    theme = prune {
      inherit (cfg.theme)
        mode
        accent
        accentFromWallpaper
        wallpaper
        radius
        transition
        spacing
        opacity
        font
        ;
    };

    clock = prune { inherit (cfg.clock) format tooltipFormat verticalFormat; };

    calendar = prune { inherit (cfg.calendar) firstDay; };

    interface = prune { inherit (cfg.interface) language; };

    desktop = prune {
      inherit (cfg.desktop)
        clockFormat
        dateFormat
        showDate
        showMedia
        ;
      enabled = cfg.desktop.enable;
    };

    weather = prune {
      inherit (cfg.weather)
        location
        latitude
        longitude
        units
        interval
        ;
    };

    media = prune { inherit (cfg.media) maxLength; };

    resources = prune {
      inherit (cfg.resources)
        interval
        showCpu
        showMemory
        showTemperature
        ;
    };

    notifications = prune {
      inherit (cfg.notifications)
        timeout
        position
        maxPopups
        doNotDisturb
        ;
    };

    launcher = prune { inherit (cfg.launcher) minScore showHidden; };

    osd = prune { inherit (cfg.osd) timeout position barRadius; };

    audio = prune { inherit (cfg.audio) maxVolume; };

    animations = prune {
      inherit (cfg.animations) duration;
      enabled = cfg.animations.enable;
    };
  };

  # `bar.enable` is the Nix spelling; the shell schema calls it `bar.enabled`.
  renameBarEnable =
    settings:
    if settings ? bar && settings.bar ? enable then
      settings // { bar = builtins.removeAttrs settings.bar [ "enable" ] // { enabled = settings.bar.enable; }; }
    else
      settings;

  finalSettings = lib.recursiveUpdate (compact (renameBarEnable generated)) cfg.settings;
in
{
  options.programs.manifold = {
    enable = mkEnableOption "Manifold, a desktop shell for niri";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "manifold.packages.\${system}.default";
      description = "The Manifold package to use.";
    };

    systemd.enable = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Start Manifold from a systemd user service bound to
        graphical-session.target. Disable this if you would rather launch it
        from niri's own {option}`spawn-at-startup`.
      '';
    };

    niri.spawnAtStartup = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Add Manifold to {option}`programs.niri.settings.spawn-at-startup`.

        Requires the niri Home Manager module to be imported. Prefer
        {option}`programs.manifold.systemd.enable`, which restarts the shell if
        it crashes and orders it against the rest of the graphical session.
      '';
    };

    # -- bar ----------------------------------------------------------------

    bar = {
      enable = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show the panel.";
      };

      position = mkOption {
        type = types.nullOr (types.enum [ "top" "bottom" "left" "right" ]);
        default = null;
        example = "top";
        description = ''
          Screen edge the panel is anchored to. `left` and `right` give a
          vertical bar, in which modules stack and the clock falls back to
          {option}`programs.manifold.clock.verticalFormat`.
        '';
      };

      size = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 38;
        description = ''
          Panel thickness in logical pixels: height when horizontal, width when
          vertical.
        '';
      };

      onAllMonitors = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show a panel on every monitor rather than only the first.";
      };

      modules = {
        start = mkOption {
          type = types.nullOr (types.listOf barModule);
          default = null;
          example = [ "workspaces" "focused-window" ];
          description = "Modules in the leading section, in order.";
        };

        center = mkOption {
          type = types.nullOr (types.listOf barModule);
          default = null;
          example = [ "clock" ];
          description = "Modules in the centre section, in order.";
        };

        end = mkOption {
          type = types.nullOr (types.listOf barModule);
          default = null;
          example = [ "tray" "system-indicators" ];
          description = "Modules in the trailing section, in order.";
        };
      };

      outputs = mkOption {
        type = types.attrsOf (
          types.submodule {
            options = {
              start = mkOption {
                type = types.nullOr (types.listOf barModule);
                default = null;
                description = "Modules in the leading section on this output.";
              };

              center = mkOption {
                type = types.nullOr (types.listOf barModule);
                default = null;
                description = "Modules in the centre section on this output.";
              };

              end = mkOption {
                type = types.nullOr (types.listOf barModule);
                default = null;
                description = "Modules in the trailing section on this output.";
              };
            };
          }
        );
        default = { };
        example = {
          "DP-2".end = [ "tray" "system-indicators" ];
        };
        description = ''
          Per-output module layouts, keyed by connector name as printed by
          `niri msg outputs`. Sections left unset fall back to
          {option}`programs.manifold.bar.modules`, and a name that matches no
          connected output is ignored.
        '';
      };
    };

    # -- theme --------------------------------------------------------------

    theme = {
      mode = mkOption {
        type = types.nullOr (types.enum [ "light" "dark" "auto" ]);
        default = null;
        example = "auto";
        description = ''
          Colour scheme. `auto` follows the desktop preference, which is what
          libadwaita applications already do.
        '';
      };

      accentFromWallpaper = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Take the accent colour from the wallpaper instead of
          {option}`programs.manifold.theme.accent`.

          The colour picked is the most present one worth using as a colour,
          not the largest area: the biggest region of a photograph is usually
          sky or shadow, and an accent made of those cannot be told apart from
          the panel. A greyscale wallpaper yields nothing and `accent` stands.
        '';
      };

      wallpaper = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "~/Pictures/wall.png";
        description = ''
          Path to the wallpaper, for
          {option}`programs.manifold.theme.accentFromWallpaper`.

          Left unset, Manifold asks around: waypaper records the answer in its
          config and swww can be queried. Wayland has no protocol for this and
          no compositor owns it, so any other setter needs the path spelled out.
        '';
      };

      accent = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "#3584e4";
        description = ''
          Accent colour, as a hex string. Overrides the libadwaita accent for
          Manifold's own surfaces only.
        '';
      };

      transition = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 250;
        description = ''
          Milliseconds the screen is frozen while light and dark swap over.

          niri holds the current frame for this long and then cross-fades to
          whatever is there afterwards, so the switch is a dissolve rather than
          every window blinking at once. The delay has to cover the slowest
          application repainting, not just Manifold. 0 turns it off.
        '';
      };

      radius = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 12;
        description = ''
          Corner radius in pixels for panels, the launcher and the controls in
          them.

          Left unset, Manifold follows the desktop: the blanket
          `* { border-radius }` rule that theme generators write into
          {file}`~/.config/gtk-4.0/gtk.css`, and square corners when there is
          no such rule.
        '';
      };

      spacing = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 6;
        description = "Base spacing unit in pixels.";
      };

      opacity = mkOption {
        type = types.nullOr (types.numbers.between 0.0 1.0);
        default = null;
        example = 1.0;
        description = "Panel background opacity.";
      };

      font = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "Cantarell 11";
        description = "Font family override. Unset keeps the system font.";
      };
    };

    # -- clock --------------------------------------------------------------

    clock = {
      format = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "%H:%M";
        description = "strftime format for the panel clock.";
      };

      verticalFormat = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "%H\\n%M";
        description = ''
          strftime format used when the bar is vertical, where a wide time does
          not fit. Newlines are honoured.
        '';
      };

      tooltipFormat = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "%A, %e %B %Y";
        description = "strftime format for the clock tooltip.";
      };
    };

    # -- calendar -----------------------------------------------------------

    calendar = {
      firstDay = mkOption {
        type = types.nullOr (types.enum [ "monday" "sunday" ]);
        default = null;
        example = "monday";
        description = ''
          Weekday the month grid starts on. Neither GLib nor GTK exposes the
          locale's own answer, so it is set here rather than detected.
        '';
      };
    };

    desktop = {
      enable = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Show widgets on the desktop: a large clock, the date, and what is
          playing.

          They sit above the wallpaper and below every window, and only while
          the monitor's active workspace holds nothing -- a clock behind a
          full-screen editor is a clock nobody can see.
        '';
      };

      clockFormat = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "%H:%M";
        description = "strftime format for the large clock.";
      };

      dateFormat = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "%A, %e %B";
        description = "strftime format for the line under the clock.";
      };

      showDate = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show the date under the clock.";
      };

      showMedia = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show what is playing, when something is.";
      };
    };

    interface.language = mkOption {
      type = types.nullOr (types.enum [ "auto" "en" "ru" ]);
      default = null;
      example = "ru";
      description = ''
        Language of the shell's own text. `auto` follows the locale.

        Only Manifold is affected: application names, notification bodies and
        window titles arrive already written by whoever sent them.
      '';
    };

    weather = {
      location = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "Reykjavik";
        description = ''
          Place name to report the weather for.

          Looked up once through Open-Meteo's geocoder, which answers with
          coordinates *and* the place's own name -- the only way the module can
          show a city at all, since the forecast API returns no name.

          {option}`latitude`/`longitude` override this when set, for anyone who
          wants a precise point; the looked-up name is still what is displayed.
        '';
      };

      latitude = mkOption {
        type = types.nullOr (types.either types.int types.float);
        default = null;
        example = 53.9;
        description = ''
          Latitude the weather is reported for.

          There is no default and no guessing. Working it out from the IP
          address would mean handing that address to a geolocation service
          before anyone agreed to it, and working it out from the timezone puts
          you in the wrong half of a continent. Unset, the module and its
          dropdown are not built at all.
        '';
      };

      longitude = mkOption {
        type = types.nullOr (types.either types.int types.float);
        default = null;
        example = 27.5667;
        description = "Longitude the weather is reported for.";
      };

      units = mkOption {
        type = types.nullOr (types.enum [ "metric" "imperial" ]);
        default = null;
        example = "metric";
        description = "`metric` gives °C and km/h; `imperial` gives °F and mph.";
      };

      interval = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 30;
        description = ''
          Minutes between fetches. Weather does not move fast and the service
          is free, so a slow poll is both enough and polite. The floor is 5.
        '';
      };
    };


    # -- media --------------------------------------------------------------

    media = {
      maxLength = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 24;
        description = "Longest track title the bar's media module shows, in characters.";
      };
    };

    # -- resources ----------------------------------------------------------

    resources = {
      interval = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 2000;
        description = "Milliseconds between readings of CPU, memory and temperature.";
      };

      showCpu = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show CPU load in the resources module.";
      };

      showMemory = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show memory use in the resources module.";
      };

      showTemperature = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Show the CPU temperature in the resources module. Hidden anyway on a
          machine where no sensor reports one.
        '';
      };
    };

    # -- notifications ------------------------------------------------------

    notifications = {
      timeout = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 5;
        description = ''
          Seconds a notification popup stays on screen. Critical notifications
          ignore this and wait for the user.
        '';
      };

      position = mkOption {
        type = types.nullOr (types.enum [
          "auto"
          "top-right"
          "top-left"
          "top-center"
          "bottom-right"
          "bottom-left"
          "bottom-center"
        ]);
        default = null;
        description = ''
          Corner that notification popups appear in. `auto` follows the bar, so
          popups rise from the bottom when the bar is there and drop from the
          top when it is not.
        '';
      };

      maxPopups = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 3;
        description = "Most popups on screen at once; the rest wait in the centre.";
      };

      doNotDisturb = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Suppress popups without dropping the notifications themselves.";
      };
    };

    # -- launcher -----------------------------------------------------------

    launcher = {
      minScore = mkOption {
        type = types.nullOr (types.numbers.between 0.0 1.0);
        default = null;
        example = 0.2;
        description = "Minimum fuzzy-match score. Lower is more permissive.";
      };

      showHidden = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Include entries marked NoDisplay in their .desktop file.";
      };
    };

    # -- osd ----------------------------------------------------------------

    osd = {
      timeout = mkOption {
        type = types.nullOr types.ints.positive;
        default = null;
        example = 1500;
        description = "Milliseconds the volume/brightness overlay stays up.";
      };

      position = mkOption {
        type = types.nullOr (types.enum [ "bottom" "top" "center" ]);
        default = null;
        description = "Where the overlay appears.";
      };

      barRadius = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 0;
        description = ''
          Corner radius of the overlay's level bar, in pixels. 0 is square;
          anything from half the bar's height upwards gives a pill.
        '';
      };
    };

    # -- animations ---------------------------------------------------------

    animations = {
      enable = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Animate panels, notifications and page transitions.

          GTK's own {option}`gtk-enable-animations` still wins: with reduced
          motion asked for system-wide, Manifold holds still whatever this says.
        '';
      };

      duration = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 180;
        description = "Base animation length in milliseconds.";
      };
    };

    # -- audio --------------------------------------------------------------

    audio = {
      maxVolume = mkOption {
        type = types.nullOr (types.numbers.between 0.0 1.5);
        default = null;
        example = 1.0;
        description = ''
          Highest volume the shell allows, where 1.0 is 100%.

          PipeWire itself goes to 150%, and the media keys will take it there.
          Manifold watches the default output and pulls anything above this
          back down.
        '';
      };
    };

    # -- workspaces ---------------------------------------------------------

    workspaces = {
      perMonitor = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Show only the workspaces belonging to the monitor the bar is on.
          Turn this off to show every workspace on every bar.
        '';
      };

      showEmpty = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Show workspaces holding no windows. Off by default: niri always keeps
          one spare workspace, which would otherwise sit in the bar as a slot
          that is never anything else. The workspace in focus is shown even
          when it is empty.
        '';
      };

      labels = mkOption {
        type = types.nullOr (types.enum [ "index" "name" "none" ]);
        default = null;
        example = "index";
        description = ''
          What each workspace button shows: its index, its name, or nothing at
          all — useful together with {option}`showIcons`.
        '';
      };

      showIcons = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show an icon for each window sitting on the workspace.";
      };

      maxIcons = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 4;
        description = ''
          Most icons drawn per workspace before the rest are dropped. Worth
          keeping low on a vertical bar, where the icons stack downwards.
        '';
      };
    };

    # -- focused window -----------------------------------------------------

    focusedWindow = {
      maxLength = mkOption {
        type = types.nullOr types.ints.unsigned;
        default = null;
        example = 48;
        description = ''
          Truncate the window title past this many characters. 0 disables
          truncation. Ignored on a vertical bar, which shows an icon instead.
        '';
      };

      showAppId = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show the application id instead of the window title.";
      };
    };

    # -- optional surfaces --------------------------------------------------

    modules = {
      controlCenter = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Build the control center panel.";
      };

      notifications = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = ''
          Run the notification daemon, popups and notification centre. Only one
          process on a system may own the freedesktop notification bus name, so
          turn this off when another shell is already serving notifications.
        '';
      };

      launcher = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Build the application launcher.";
      };

      osd = mkOption {
        type = types.nullOr types.bool;
        default = null;
        description = "Show the volume and brightness overlay.";
      };
    };

    # -- escape hatch -------------------------------------------------------

    settings = mkOption {
      type = jsonFormat.type;
      default = { };
      example = lib.literalExpression ''
        {
          workspaces.labels = "none";
          focusedWindow.maxLength = 60;
        }
      '';
      description = ''
        Raw settings merged into the generated config.json, taking precedence
        over the structured options above. Use this for keys that do not have a
        dedicated option yet.
      '';
    };
  };

  config = mkIf cfg.enable (
    lib.mkMerge [
      {
        assertions = [
          {
            assertion = cfg.niri.spawnAtStartup -> hasNiriModule;
            message = ''
              programs.manifold.niri.spawnAtStartup needs niri's own Home
              Manager module, which is not imported. Either import it, or
              leave the option off and let programs.manifold.systemd.enable
              start the shell.
            '';
          }
        ];

        home.packages = [ cfg.package ];

        xdg.configFile."manifold/config.json".source =
          jsonFormat.generate "manifold-config.json" finalSettings;

        systemd.user.services.manifold = mkIf cfg.systemd.enable {
          Unit = {
            Description = "Manifold desktop shell";
            Documentation = "https://github.com/cublae/Manifold";
            PartOf = [ "graphical-session.target" ];
            After = [ "graphical-session.target" ];
            # The shell is useless without a compositor socket to talk to.
            ConditionEnvironment = [ "WAYLAND_DISPLAY" ];
          };

          Service = {
            ExecStart = "${cfg.package}/bin/manifold";
            Restart = "on-failure";
            RestartSec = 2;
            Slice = "session.slice";
          };

          Install.WantedBy = [ "graphical-session.target" ];
        };
      }

      (lib.optionalAttrs hasNiriModule {
        programs.niri.settings.spawn-at-startup = mkIf cfg.niri.spawnAtStartup [
          { command = [ "${cfg.package}/bin/manifold" ]; }
        ];
      })
    ]
  );
}
