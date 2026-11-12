import { describe, expect, it } from "vitest";

import { imageSize } from "@/lib/image-size";
import { sniffImage } from "@/lib/receipt-upload";

/**
 * Real files written by an encoder (Pillow), so the parser is checked against what cameras and
 * apps produce rather than against bytes laid out by hand. 301×17 and 17×301 catch a swapped
 * width and height and a byte-order mistake (301 doesn't fit in one byte).
 */
const FILES: Record<string, string> = {
  jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAARAS0DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgqKKK8M/VAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==",
  jpeg_progressive:
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAARAS0DASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAWAQEBAQAAAAAAAAAAAAAAAAAABAb/2gAMAwEAAhADEAAAAYAh1QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAABg/9oACAEBAAEFAmX/xAAUEQEAAAAAAAAAAAAAAAAAAABQ/9oACAEDAQE/ARv/xAAUEQEAAAAAAAAAAAAAAAAAAABQ/9oACAECAQE/ARv/xAAUEAEAAAAAAAAAAAAAAAAAAABg/9oACAEBAAY/AmX/xAAUEAEAAAAAAAAAAAAAAAAAAABg/9oACAEBAAE/IWX/2gAMAwEAAgADAAAAEPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP/8QAFBEBAAAAAAAAAAAAAAAAAAAAUP/aAAgBAwEBPxAb/8QAFBEBAAAAAAAAAAAAAAAAAAAAUP/aAAgBAgEBPxAb/8QAFBABAAAAAAAAAAAAAAAAAAAAYP/aAAgBAQABPxBl/9k=",
  jpeg_exif:
    "/9j/4AAQSkZJRgABAQAAAQABAAD/4QDsRXhpZgAATU0AKgAAAAgAAQEOAAIAAADJAAAAGgAAAAB4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eAAA/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAEQEtAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A4KiiivDP1QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=",
  png: "iVBORw0KGgoAAAANSUhEUgAAABEAAAEtCAYAAADuoouYAAAAK0lEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAzgZRIQABeULyFQAAAABJRU5ErkJggg==",
  webp_lossy:
    "UklGRnAAAABXRUJQVlA4IGQAAACQBQCdASotAREAPtFosFMoJiSioOgBABoJaQDQTv0gAADuyq+XuNPeTfTp06z1gx50d8HuAAD+7Qcv16VhVar/+Sn/n9/P7nYvmrnlZHBCC25RCk8FO+fKyOZV2mZ30AAAAAAA",
  webp_lossless: "UklGRiQAAABXRUJQVlA4TBcAAAAvLAEEAAdQhSJXof8BICH8ny9F9D8lBAA=",
  webp_alpha:
    "UklGRm4AAABXRUJQVlA4WAoAAAAQAAAALAEAEAAAQUxQSBAAAAABB1CyiAgACeH/fCmi/ykhVlA4IDgAAACwBACdASotAREAPtFosFMoJiSioOgBABoJaQAAB3ZVfL3GnvJvp06dOnTp06b4AP7zYgAAAAAAAA==",
};

const bytesOf = (name: string) => new Uint8Array(Buffer.from(FILES[name], "base64"));

function sizeOf(name: string) {
  const bytes = bytesOf(name);
  const mime = sniffImage(bytes);
  if (!mime) throw new Error(`${name} is not an image`);
  return imageSize(bytes, mime);
}

describe("imageSize", () => {
  it.each([
    ["jpeg", 301, 17],
    ["jpeg_progressive", 301, 17],
    ["jpeg_exif", 301, 17],
    ["png", 17, 301],
    ["webp_lossy", 301, 17],
    ["webp_lossless", 301, 17],
    ["webp_alpha", 301, 17],
  ])("reads %s as %i×%i", (name, width, height) => {
    expect(sizeOf(name)).toEqual({ width, height });
  });

  it("answers null, not a size, for a header cut short", () => {
    for (const name of Object.keys(FILES)) {
      const mime = sniffImage(bytesOf(name))!;
      expect(imageSize(bytesOf(name).subarray(0, 14), mime)).toBeNull();
    }
  });
});
