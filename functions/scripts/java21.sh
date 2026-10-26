# Sourced by run-all.command (and run-all-unit.mjs). java21_bin DIR... prints the first DIR whose
# `java` reports version 21 and returns 1 when none does.
#
# `/usr/libexec/java_home -v 21` is not a check on its own: with no registered JDK 21 (Homebrew's
# openjdk@21 is keg-only) it exits 0 and answers with the default JVM, so run-all.command used to
# put Java 8 first on PATH ahead of a Java 21 that was already there. Every candidate is asked.
java21_bin() {
  local dir version
  for dir in "$@"; do
    [ -x "$dir/java" ] || continue
    version="$("$dir/java" -version 2>&1 || true)"
    case "$version" in
      *'version "21'*) printf '%s\n' "$dir"; return 0 ;;
    esac
  done
  return 1
}
