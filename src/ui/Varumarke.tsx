/**
 * The app's name with the finch beside it, as the page's one h1.
 *
 * The picture is the 192 px app icon, already precached for the home
 * screen, so it costs nothing extra and shows offline. It is decorative:
 * the heading's name stays "Bokfink" for a screen reader.
 */
export function Varumarke() {
  return (
    <h1 className="varumarke">
      <img
        className="varumarke__logga"
        src="/icons/icon-192.png"
        alt=""
        width={40}
        height={40}
      />
      Bokfink
    </h1>
  );
}
