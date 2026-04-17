import unittest

from seminar.markdown import shift_headings


class ShiftHeadingsTests(unittest.TestCase):
    def test_shifts_atx_headings_by_requested_depth(self) -> None:
        self.assertEqual(
            shift_headings("# Title\n\n## Abstract\n", levels=2),
            "### Title\n\n#### Abstract\n",
        )

    def test_caps_heading_depth_at_six(self) -> None:
        self.assertEqual(shift_headings("##### Deep\n", levels=3), "###### Deep\n")

    def test_skips_fenced_code_blocks(self) -> None:
        self.assertEqual(
            shift_headings("## Abstract\n\n```md\n## Not a heading\n```\n", levels=2),
            "#### Abstract\n\n```md\n## Not a heading\n```\n",
        )

    def test_skips_indented_code_blocks(self) -> None:
        self.assertEqual(
            shift_headings("## Abstract\n\n    ## Not a heading\n", levels=2),
            "#### Abstract\n\n    ## Not a heading\n",
        )


if __name__ == "__main__":
    _ = unittest.main()
