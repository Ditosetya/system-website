/* Model awal diekspor dari model_c45.pkl. */
window.ORIGINAL_MODEL = {"tree":{"feature":"Status Orang Tua","value":null,"children":{"1":{
        "feature":"Pekerjaan Ibu","value":null,"children":{"4":{"feature":null,"value":0,"children":{}},"5":{
        "feature":"Pendidikan Akhir Ibu","value":null,"children":{"1":{"feature":null,"value":1,"children":{}},"2":{"feature":null,"value":0,"children":{}},"3":{"feature":null,"value":1,"children":{}}}},"6":{
        "feature":"Jumlah Saudara Sekolah","value":null,"children":{"1":{"feature":null,"value":0,"children":{}},"2":{"feature":null,"value":1,"children":{}}}},"8":{"feature":null,"value":1,"children":{}},"10":{"feature":null,"value":0,"children":{}},"15":{
        "feature":"Pekerjaan Ayah","value":null,"children":{"2":{"feature":null,"value":1,"children":{}},"4":{"feature":null,"value":0,"children":{}},"5":{"feature":null,"value":1,"children":{}},"6":{"feature":null,"value":1,"children":{}},"8":{"feature":null,"value":0,"children":{}},"10":{"feature":null,"value":1,"children":{}}}}}},"3":{"feature":null,"value":1,"children":{}}}},"majority_class_global":1,
        "feature_columns":["Jumlah Saudara Sekolah","Pekerjaan Ayah","Pendidikan Akhir Ayah","Pekerjaan Ibu","Pendidikan Akhir Ibu","Penerima PIP","Status Orang Tua","Kehadiran Siswa"],
        "feature_mappings":{"Jumlah Saudara Sekolah":{"tidak ada":0,"sedang":1,"banyak":2},"Pekerjaan Ayah":{"nelayan":1,"petani":2,"peternak":3,"pns/tni/polri":4,"karyawan swasta":5,"pedagang kecil":6,"pedagang besar":7,"wiraswasta":8,"wirausaha":9,"buruh":10,"buruh tani":10,"pensiunan":11,"tenaga kerja indonesia":12,"karyawan bumn":13,"sudah meninggal":14,"tidak bekerja":15,"ibu rumah tangga":15},
        "Pendidikan Akhir Ayah":{"rendah":1,"sedang":2,"tinggi":3},"Pekerjaan Ibu":{"nelayan":1,"petani":2,"peternak":3,"pns/tni/polri":4,"karyawan swasta":5,"pedagang kecil":6,"pedagang besar":7,"wiraswasta":8,"wirausaha":9,"buruh":10,"buruh tani":10,"pensiunan":11,"tenaga kerja indonesia":12,"karyawan bumn":13,"sudah meninggal":14,"tidak bekerja":15,"ibu rumah tangga":15},
        "Pendidikan Akhir Ibu":{"rendah":1,"sedang":2,"tinggi":3},
        "Penerima PIP":{"tidak":0,"ya":1},
        "Status Orang Tua":{"lengkap":1,"yatim":2,"piatu":3,"yatim piatu":4},
        "Kehadiran Siswa":{"tinggi":1,"sedang":2,"rendah":3}},
        "metrics":{"accuracy":0.7777777777777778,"precision":0.75,"recall":0.75,"f1_score":0.75,"confusion_matrix":[[4,1],[1,3]],"labels":[0,1],"test_size":0.2,"random_state":42}};