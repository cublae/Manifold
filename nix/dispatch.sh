#!/bin/sh
# Hand a command to the running shell over the bus.
#
# Running the binary a second time already did nothing but forward its command
# line to the first instance -- that is what GApplication is for. The trouble is
# what it cost to get there: the bundled JavaScript is unpacked out of a 2 MB
# wrapper onto disk and a whole GJS runtime comes up with GTK and libadwaita
# before a single word is said. A third of a second, every time, for a keystroke
# that toggles a window.
#
# So the command goes straight to the bus instead. Same request, same handler,
# without starting a second copy of the shell to deliver it.
#
# With no arguments there is nothing to forward: that is the shell itself
# starting, and it goes the long way.

set -u

REAL="@real@"
GDBUS="@gdbus@"
NAME="io.Astal.manifold"
OBJECT="/io/Astal/Application"
METHOD="io.Astal.Application.Request"

[ $# -eq 0 ] && exec "$REAL"

# Build the GVariant array by hand, quoting every argument and escaping what
# would end it early, so a window name carrying a space or a quote survives.
#
# The escaping needs sed, and sed needs a fork, which is a measurable part of
# what this path costs -- so it runs only for the arguments that actually
# contain something to escape. Commands and window names never do.
args=""
for arg in "$@"; do
  case $arg in
  *\\* | *\"*)
    escaped=$(printf '%s' "$arg" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
    ;;
  *)
    escaped=$arg
    ;;
  esac
  args="${args:+$args,}\"$escaped\""
done

if ! reply=$("$GDBUS" call --session --dest "$NAME" --object-path "$OBJECT" \
  --method "$METHOD" "[$args]" 2>&1); then
  # The name being absent is the ordinary case -- the shell is not running --
  # and it deserves a sentence rather than a D-Bus trace. Every other failure
  # is passed along as-is, since it is the caller's to interpret.
  case $reply in
  *ServiceUnknown* | *"not provided by any .service files"*)
    echo "manifold: not running" >&2
    exit 1
    ;;
  *NoReply* | *"Remote peer disconnected"*)
    # Asking the shell to quit and then complaining that it did not answer is
    # not a failure worth reporting: it left, which is what was asked. Any
    # other command losing its reply is a real one.
    if [ "$1" = quit ]; then
      exit 0
    fi
    ;;
  esac

  printf '%s\n' "$reply" >&2
  exit 1
fi

# gdbus renders the reply as a GVariant tuple holding one string: ('text',).
# Unwrap it back into the text the shell actually answered with.
body=${reply#(}
body=${body%,)}
body=${body#?}
body=${body%?}

# The quote characters gdbus escaped are put back first, then printf turns the
# rest of the C escapes -- \n above all, since the usage text and the window
# list are both several lines -- into the bytes they stand for. The same
# reasoning as above: sed only where there is a quote to unescape.
case $body in
*\\\'* | *\\\"*)
  body=$(printf '%s' "$body" | sed -e "s/\\\\'/'/g" -e 's/\\"/"/g')
  ;;
esac

printf '%b\n' "$body"
