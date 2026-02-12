<?php
if ($_SERVER['HTTP_SEC_FETCH_MODE'] != 'cors') {
    http_response_code(403); # Forbidden
    exit;
}

function get_db_config()
{
    $cnf_path = '.my.cnf'; # CONFIG: Adjust path as needed
    if (!file_exists($cnf_path)) return null;
    $config = parse_ini_file($cnf_path, true, INI_SCANNER_RAW);
    $client = isset($config['client']) ? $config['client'] : null;
    if (!$client) return null;
    $host = $client['host'] ?? 'localhost';
    $dbname = $client['database'] ?? '';
    $port = $client['port'] ?? 3306;
    $dsn = "mysql:host={$host};dbname={$dbname};port={$port};charset=utf8mb4";
    if ($_SERVER['REQUEST_METHOD'] == 'GET') {
        $dsn .= ';readOnly=1;readTimeout=5';
    }
    return [
        'dsn' => $dsn,
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
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "type" => "FeatureCollection",
        "features" => [],
        "error" => "Database connection error: " . $e->getMessage()
    ]);
    exit;
}

$request_uri = $_SERVER['REQUEST_URI'];
$method = $_SERVER['REQUEST_METHOD'];

$path = parse_url($request_uri, PHP_URL_PATH);
$base_path = '/~tad/test/';
$api_path = str_replace($base_path, '', $path);
$segments = explode('/', trim($api_path, '/'));
$resource = $segments[1] ?? '';
$action = $segments[2] ?? '';

if ($segments[0] !== 'api' || $resource !== 'mountains') {
    http_response_code(404);
    echo json_encode(['error' => 'Not Found']);
} elseif ($action === 'geojson') {
    #
    # 全件GeoJSON: /api/mountains/geojson
    #
    $sql = <<<EOS
        SELECT
            u.id,
            name_text AS name,
            display_lat AS lat,
            display_lon AS lon,
            min_zoom_level AS zmin
        FROM unified_pois AS u
        JOIN poi_names ON u.id =unified_poi_id
        LEFT JOIN poi_hierarchies ON u.id = parent_id
        WHERE is_preferred
            AND parent_id IS NULL
            AND display_lat != 0
            AND display_lon != 0
        EOS;
    $stmt = $pdo->query($sql);
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
                "zmin" => (int)($row['zmin'] ?? 13)
            ]
        ];
    }

    header("Content-Type: application/geo+json; charset=utf-8");
    header('Cache-Control: no-store, max-age=0');
    echo json_encode(
        ["type" => "FeatureCollection", "features" => $features],
        JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK
    );
} elseif ($action === 'search') {
    #
    # 山名検索: /api/mountains/search?q=xxx
    #
    $search_term = $_GET['q'] ?? '';
    if (preg_match('/^[0-9]+$/', $search_term)) {
        if ((int)$search_term == 0) {
            $sql = <<<EOS
                SELECT 
                    u.id,
                    u.display_lat AS lat,
                    u.display_lon AS lon,
                    ROUND(u.elevation_m) AS alt,
                    p.name_text AS name,
                    p.name_reading AS kana
                FROM unified_pois AS u
                JOIN poi_names AS p ON u.id = p.unified_poi_id
                WHERE p.is_preferred
                ORDER BY u.id DESC
                LIMIT 100
                EOS;
            $stmt = $pdo->query($sql);
        } else {
            $sql = <<<EOS
                SELECT 
                    u.id,
                    u.display_lat AS lat,
                    u.display_lon AS lon,
                    ROUND(u.elevation_m) AS alt,
                    p.name_text AS name,
                    p.name_reading AS kana
                FROM unified_pois AS u
                JOIN poi_names AS p ON u.id = p.unified_poi_id
                WHERE u.id = ?
                AND p.is_preferred
                EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$search_term]);
        }
    } else {
        $m = explode('@', $search_term, 2);
        if (count($m) == 2) {
            $sql = <<<EOS
                SELECT
                    u.id,
                    u.display_lat AS lat,
                    u.display_lon AS lon,
                    ROUND(u.elevation_m) AS alt,
                    p.name_text AS name,
                    p.name_reading AS kana
                FROM unified_pois AS u
                JOIN poi_names AS p ON u.id = p.unified_poi_id AND p.is_preferred
                WHERE EXISTS (
                    SELECT 1 FROM poi_address_map AS pam
                    JOIN administrative_regions AS ar ON pam.jis_code = ar.jis_code
                    WHERE pam.unified_poi_id = u.id AND ar.full_name LIKE ?
                )
                AND EXISTS (
                    SELECT 1 FROM poi_names AS p2
                    WHERE p2.unified_poi_id = u.id
                        AND p2.name_reading > ''
                        AND p2.name_normalized LIKE ?
                )
                ORDER BY u.elevation_m DESC
                LIMIT 1000
                EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$m[1] . "%", $m[0]]);
        } else {
            $sql = <<<EOS
                SELECT
                    u.id,
                    u.display_lat AS lat,
                    u.display_lon AS lon,
                    ROUND(u.elevation_m) AS alt,
                    p.name_text AS name,
                    p.name_reading AS kana
                FROM unified_pois AS u
                JOIN poi_names AS p ON u.id = p.unified_poi_id
                WHERE u.id IN (
                    SELECT DISTINCT unified_poi_id
                    FROM poi_names
                    WHERE name_reading > '' AND name_normalized LIKE ?
                ) AND p.is_preferred
                ORDER BY u.elevation_m DESC
                LIMIT 1000
                EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$search_term]);
        }
    }
    $results = $stmt->fetchAll();
    header("Content-Type: application/json; charset=utf-8");
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($results, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);
} elseif (is_numeric($action)) {
    #
    # 個別情報: /api/mountains/{id}
    #
    $id = (int)$action;
    $sql = <<<EOS
        SELECT
            u.id,
            -- 1. names (POI名リスト)
            (
                SELECT JSON_ARRAYAGG(JSON_OBJECT('name', name_text, 'kana', name_reading))
                FROM (
                    SELECT name_text, name_reading
                    FROM poi_names
                    WHERE unified_poi_id = u.id AND name_reading > ''
                    GROUP BY name_text, name_reading
                    ORDER BY MAX(is_preferred) DESC, name_text ASC
                ) AS t
            ) AS names,
            -- 2. gcp_name (GCPからの名前)
            (
                SELECT s.names_json->>'$[0].name'
                FROM stg_gsi_gcp_pois AS s
                JOIN poi_links AS l ON s.source_uuid = l.source_uuid
                WHERE l.unified_poi_id = u.id
                LIMIT 1
            ) AS gcp_name,
            u.display_lat AS lat,
            u.display_lon AS lon,
            ROUND(u.elevation_m) AS alt,
            -- 3. address (poi_address_mapを利用)
            (
                SELECT JSON_ARRAYAGG(ar.full_name)
                FROM poi_address_map AS pam
                JOIN administrative_regions AS ar ON pam.jis_code = ar.jis_code
                WHERE pam.unified_poi_id = u.id
                ORDER BY pam.jis_code
            ) AS address,
            i.display_name AS auth
        FROM unified_pois AS u
        JOIN poi_names AS p ON u.id = p.unified_poi_id
        JOIN information_sources AS i ON i.id = p.source_id
        WHERE p.is_preferred AND u.id = ?
        EOS;
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$id]);
    $result = $stmt->fetch();
    if (!$result) {
        http_response_code(404);
        echo json_encode(['error' => 'Not Found']);
        $pdo = null; // Close connection
        exit;
    }
    $result['names'] = json_decode($result['names'], true);
    $result['address'] = json_decode($result['address'], true);
    header("Content-Type: application/json; charset=utf-8");
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Invalid Action']);
}

$pdo = null; // Close connection
