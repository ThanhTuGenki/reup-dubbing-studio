from reup.assets import AssetStore

def test_layout(tmp_path):
    st = AssetStore(tmp_path)
    assert st.dir("v1").is_dir()
    assert st.p("v1", "raw.mp4") == tmp_path / "videos" / "v1" / "raw.mp4"
    st.p("v1", "dub/0001.wav")  # tạo thư mục cha
    assert (tmp_path / "videos" / "v1" / "dub").is_dir()

def test_json_roundtrip(tmp_path):
    st = AssetStore(tmp_path)
    st.write_json("v1", "timings.json", {"desub": 12.5})
    assert st.read_json("v1", "timings.json") == {"desub": 12.5}
