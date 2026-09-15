export type ImageMarker = {
  type: "image";
  /** RGBA pixels, same format as `ImageData.data`. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

export type Data = {
  /// Pattern chosen for the corners of the document; bullseye is the default.
  /// Pass an ImageMarker to match a custom marker loaded from an image.
  cornerPattern?: "bullseye" | ImageMarker;

  /// Used to define the scale of values like width, height, gaps, startX, startY.
  /// Example: if cornerSize is 100, and alternatives[n].width = 100, the alternative width equals the corner marker width.
  cornerSize: number;

  /// Definition of blocks of answers (a set of rows and columns of answers to be parsed).
  answersBlocks: {
    /// Starting position of the block in the document, in the X axis.
    startX: number;
    /// Starting position of the block in the document, in the Y axis.
    startY: number;
    /// Number of rows of answers in the block.
    rows: number;
    /// Number of columns of answers in the block.
    columns: number;
    /// Width of each answer/alternative in the block.
    width: number;
    /// Height of each answer/alternative in the block.
    /// If not provided, height = width (square aspect ratio).
    height?: number;

    /// Gaps between the alternatives borders (not centers).
    gaps: {
      /// Gaps between the columns of answers in the block.
      columns: number;
      /// Gaps between the rows of answers in the block.
      rows: number;
    };
  }[];
};
