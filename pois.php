<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/geo+json; charset=utf-8");

$target = isset($_GET['db']) ? $_GET['db'] : 'yamap';

function get_db_config() {
    $cnf_path = '.my.cnf'; # CONFIG: Adjust path as needed
    if (!file_exists($cnf_path)) return null;
    $config = parse_ini_file($cnf_path, true, INI_SCANNER_RAW);
    $client = isset($config['client']) ? $config['client'] : null;
    if (!$client) return null;
    $host = $client['host'] ?? 'localhost';
    $dbname = $client['database'] ?? '';
    $port = $client['port'] ?? 3306;
    return [
        'dsn' => "mysql:host={$host};dbname={$dbname};port={$port};charset=utf8mb4",
        'user' => $client['user'] ?? '',
        'pass' => $client['password'] ?? ''
    ];
}

$db_config = get_db_config();
if (!$db_config) {
    http_response_code(500);
    echo json_encode(["error" => "Configuration file (.my.cnf) not found or invalid"]);
    exit;
}

try {
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    $pdo = new PDO($db_config['dsn'], $db_config['user'], $db_config['pass'], $options);

    $query = <<<EOS
SELECT
    u.id,
    name_text AS name,
    name_reading AS kana,
    display_lat AS lat,
    display_lon AS lon,
    elevation_m AS alt,
    min_zoom_level AS zmin
FROM unified_pois AS u
JOIN poi_names ON u.id =unified_poi_id
LEFT JOIN poi_hierarchies ON u.id = parent_id
WHERE is_preferred AND parent_id IS NULL
EOS;

    $stmt = $pdo->query($query);
    $features = [];

    while ($row = $stmt->fetch()) {
        $features[] = [
            "id" => (int)$row['id'],
            "type" => "Feature",
            "geometry" => [
                "type" => "Point",
                "coordinates" => [(float)$row['lon'], (float)$row['lat']]
            ],
            "properties" => [
                "name" => $row['name'],
                "kana" => $row['kana'],
                "alt" => (int)($row['alt'] ?? -9999),
                "zmin" => (int)($row['zmin'] ?? 13)
            ]
        ];
    }

    echo json_encode([
        "type" => "FeatureCollection",
        "features" => $features
    ], JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "type" => "FeatureCollection",
        "features" => [],
        "error" => "Database error: " . $e->getMessage()
    ]);
} finally {
    $pdo = null;
}
?>
