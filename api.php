<?php
if ($_SERVER['HTTP_SEC_FETCH_MODE'] != 'cors') {
    http_response_code(403); # Forbidden
    exit;
}

$env_path = $_SERVER['ENV_PATH'] ?? __DIR__ . '/.env.php';
if (file_exists($env_path)) {
    $config = require $env_path;
    foreach ($config as $key => $value) {
        if (!isset($_SERVER[$key])) {
            $_SERVER[$key] = $value;
        }
    }
}
$host = $_SERVER['DB_HOST'] ?? 'localhost';
$port = $_SERVER['DB_PORT'] ?? 3306;
$user = $_SERVER['DB_USER'] ?? null;
$pass = $_SERVER['DB_PASS'] ?? null;
$dbname = $_SERVER['DB_NAME'] ?? null;
$dsn = "mysql:host={$host};dbname={$dbname};port={$port};charset=utf8mb4";
if (!$user || !$pass || !$dbname) {
    http_response_code(500);
    echo json_encode([
        "error" => "Database configuration is missing. Please check the .env.php file."
    ]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] == 'GET') {
    $dsn .= ';readOnly=1;readTimeout=5';
}

try {
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "error" => "Database connection error: " . $e->getMessage()
    ]);
    exit;
}

function get_lat_lon()
{
    $args = [
        'lat' => [
            'filter' => FILTER_VALIDATE_FLOAT,
            'options' => ['min_range' => -90, 'max_range' => 90]
        ],
        'lon' => [
            'filter' => FILTER_VALIDATE_FLOAT,
            'options' => ['min_range' => -180, 'max_range' => 180]
        ]
    ];
    return filter_input_array(INPUT_GET, $args);
}

$request_uri = $_SERVER['REQUEST_URI'];
$method = $_SERVER['REQUEST_METHOD'];
$api_path = parse_url($request_uri, PHP_URL_PATH);
$api_base = $_SERVER['API_BASE'] ?? '/v2';
if (str_starts_with($api_path, $api_base)) {
    $api_path = substr($api_path, strlen($api_base));
}
$segments = explode('/', trim($api_path, '/'));
if ($segments[0] !== 'api') {
    http_response_code(404);
    echo json_encode(['error' => 'Invalid API path']);
    exit;
}
$resource = $segments[1] ?? '';
$action = $segments[2] ?? '';

if ($resource === 'mountains') {
    // ----------------------------------------------------
    // 山名ベクトルタイル: /api/mountains/xyz/{z}/{x}/{y}.geojson
    // ----------------------------------------------------
    if ($action === 'xyz') {
        $z = $segments[3] ?? null;
        $x = $segments[4] ?? null;
        $y = $segments[5] ?? null;
        if (str_ends_with($y, '.geojson')) {
            $y = substr($y, 0, -8);
        }
        if (!is_numeric($z) || !is_numeric($x) || !is_numeric($y)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid tile coordinates']);
            exit;
        }

        $diff_z = 18 - $z;
        $min_x = $x << $diff_z;
        $max_x = (($x + 1) << $diff_z) - 1;
        $min_y = $y << $diff_z;
        $max_y = (($y + 1) << $diff_z) - 1;
        $zoom = $z + 1; // ラスタタイルのズームレベルを計算

        $source_id = $_GET['source'] ?? 0;
        if ($source_id == 0) {
            $sql = <<<EOS
                SELECT id, main_name AS name, lat, lon, z_min
                FROM mountain_pois
                WHERE is_used
                    AND x_z18 BETWEEN ? AND ?
                    AND y_z18 BETWEEN ? AND ?
                    AND z_min <= ?
                    AND NOT EXISTS (SELECT 1 FROM poi_hierarchies WHERE parent_id = id)
            EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$min_x, $max_x, $min_y, $max_y, $zoom]);
        } else {
            $stmt = $pdo->prepare("SELECT source_table FROM information_sources WHERE id = ?");
            $stmt->execute([$source_id]);
            $row = $stmt->fetch();
            if (!$row) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid source ID']);
                exit;
            }
            $source_table = $row['source_table'];
            $sql = <<<EOS
                SELECT
                    COALESCE(p.mountain_id, 0) AS id,
                    s.names_json->>'$[0].name' AS name,
                    s.lat,
                    s.lon,
                    s.z_min
                FROM {$source_table} AS s
                LEFT JOIN poi_links AS p ON s.source_uuid = p.source_uuid AND p.source_id = ?
                WHERE s.x_z18 BETWEEN ? AND ?
                    AND s.y_z18 BETWEEN ? AND ?
                    AND s.z_min <= ?
            EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$source_id, $min_x, $max_x, $min_y, $max_y, $zoom]);
        }

        header("Content-Type: application/geo+json; charset=utf-8");
        $max_age = 604800; # 7 days
        header("Cache-Control: public, max-age={$max_age}, stale-while-revalidate=86400");

        echo '{"type": "FeatureCollection", "features": [';
        $first = true;
        while ($row = $stmt->fetch()) {
            if (!$first) echo ',';
            $feature = [
                "id" => (int)$row['id'],
                "type" => "Feature",
                "geometry" => [
                    "type" => "Point",
                    "coordinates" => [(float)$row['lon'], (float)$row['lat']]
                ],
                "properties" => [
                    "name" => $row['name'],
                    "z_min" => (int)($row['z_min'] ?? 13)
                ]
            ];
            echo json_encode($feature, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);
            $first = false;
        }
        echo ']}';

    // ----------------------------------------------------
    // 山名検索: /api/mountains/search?q=xxx
    // ----------------------------------------------------
    } elseif ($action === 'search') {
        $search_term = $_GET['q'] ?? '';
        if (preg_match('/^[0-9]+$/', $search_term)) {
            // 数値（ID）検索のロジック
            $sql = <<<EOS
                SELECT id, main_name AS name, main_kana AS kana, lat, lon, ROUND(elevation) AS elev
                FROM mountain_pois
                WHERE is_used
            EOS;
            if ((int)$search_term == 0) {
                $sql .= " ORDER BY id DESC LIMIT 100";
                $stmt = $pdo->query($sql);
            } else {
                $sql .= " AND id = ?";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$search_term]);
            }
        } else {
            // 文字列曖昧・地域指定検索のロジック
            $m = explode('@', $search_term, 2);
            $op = '=';
            if (str_contains($m[0], '%')) {
                $starts = str_starts_with($m[0], '%');
                $ends = str_ends_with($m[0], '%');
                if ($starts || $ends) $op = 'LIKE';
                $m[0] = str_replace('%', '', $m[0]);
                $m[0] = ($starts ? '%' : '') . $m[0] . ($ends ? '%' : '');
            }
            $sql = <<<EOS
                SELECT src_char, dst_char
                FROM char_trans_map
                WHERE hit_count > 0
                ORDER BY hit_count DESC
            EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute();
            $trans_map = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
            $m[0] = str_replace(
                array_keys($trans_map),
                array_values($trans_map),
                $m[0]
            );

            $bind_params = [];
            if (count($m) == 2) {
                $m[1] = str_replace('%', '', $m[1]);
                $sql = <<<EOS
                    WITH matched_names AS (
                        SELECT DISTINCT pn.mountain_id
                        FROM poi_names AS pn
                        JOIN poi_address_map AS pm ON pn.mountain_id = pm.mountain_id
                        JOIN administrative_regions AS ar ON pm.jis_code = ar.jis_code
                        WHERE pn.poi_name_normalized $op ?
                            AND pn.poi_kana IS NOT NULL
                            AND pn.poi_kana <> ''
                            AND ar.full_name LIKE CONCAT(?, '%')
                    )
                EOS;
                $bind_params = [$m[0], $m[1]];
            } else {
                $sql = <<<EOS
                    WITH matched_names AS (
                        SELECT DISTINCT pn.mountain_id
                        FROM poi_names AS pn
                        WHERE pn.poi_name_normalized $op ?
                            AND pn.poi_kana IS NOT NULL
                            AND pn.poi_kana <> ''
                    )
                EOS;
                $bind_params = [$m[0]];
            }

            $sql .= <<<EOS
                SELECT m.id, m.main_name AS name, m.main_kana AS kana, m.lat, m.lon, ROUND(m.elevation) AS elev
                FROM mountain_pois AS m
                WHERE m.is_used AND (
                    EXISTS (
                        SELECT 1
                        FROM poi_hierarchies AS ph
                        JOIN matched_names AS mn ON ph.parent_id = mn.mountain_id
                        WHERE ph.child_id = m.id
                    )
                    OR (
                        m.id IN (SELECT mountain_id FROM matched_names)
                        AND NOT EXISTS (SELECT 1 FROM poi_hierarchies WHERE parent_id = m.id)
                    )
                )
                ORDER BY m.elevation DESC
                LIMIT 1000
            EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute($bind_params);
        }
        $results = $stmt->fetchAll();
        header("Content-Type: application/json; charset=utf-8");
        header('Cache-Control: no-store, max-age=0');
        echo json_encode($results, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);

    // ----------------------------------------------------
    // 最寄りの山: /api/mountains/nearest?lat=xxx&lon=yyy
    // ----------------------------------------------------
    } elseif ($action === 'nearest') {
        $coordinates = get_lat_lon();
        $lat = $coordinates['lat'];
        $lon = $coordinates['lon'];
        if (!($lat && $lon)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid latitude or longitude']);
            exit;
        }
        $max_dist = 100;
        $limit = 1;

        $stmt = $pdo->prepare("SET @center = ST_GeomFromText(?, 4326, 'axis-order=long-lat')");
        $stmt->execute(["POINT($lon $lat)"]);

        $sql = <<<EOS
            SELECT m.id, m.main_name AS name, m.main_kana AS kana,
                m.lat, m.lon, ROUND(m.elevation) AS elev,
                ST_Distance_Sphere(m.geom, @center) AS distance
            FROM mountain_pois AS m
            WHERE m.is_used
                AND ST_Within(m.geom, ST_Buffer(@center, ?))
                AND NOT EXISTS (SELECT 1 FROM poi_hierarchies WHERE child_id = m.id)
            ORDER BY distance
            LIMIT ?
        EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$max_dist, $limit]);
        $results = $stmt->fetchAll();

        foreach ($results as $i => $result) {
            $sql = <<<EOS
                SELECT DISTINCT a.pref_code AS code, a.pref_name AS name, a.pref_qid AS qid
                FROM poi_address_map AS p
                JOIN administrative_regions AS a ON p.jis_code = a.jis_code
                WHERE p.mountain_id = ?
            EOS;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$result['id']]);
            $results[$i]['prefectures'] = $stmt->fetchAll();
        }
        header("Content-Type: application/json; charset=utf-8");
        header('Cache-Control: no-store, max-age=0');
        echo json_encode($results, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);

    } elseif (!is_numeric($action)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid mountain ID']);
        exit;

    // ----------------------------------------------------
    // 登頂した山行記録: /api/mountains/{id}/records
    // ----------------------------------------------------
    } elseif ($segments[3] === 'records') {
        $mountain_id = (int)$action;
        $sql = <<<EOS
            SELECT r.id, r.start_date, r.end_date, r.published_at, r.title, r.summary, r.public_url, r.image_url
            FROM mountain_records AS r
            JOIN visited_mountains AS v ON r.id = v.mountain_record_id
            WHERE v.mountain_id = ?
            ORDER BY r.start_date DESC
        EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$mountain_id]);
        $results = $stmt->fetchAll();

        header("Content-Type: application/json; charset=utf-8");
        header('Cache-Control: no-store, max-age=0');
        echo json_encode($results, JSON_UNESCAPED_UNICODE);

    // ----------------------------------------------------
    // 山の個別情報: /api/mountains/{id}
    // ----------------------------------------------------
    } else {
        $mountain_id = (int)$action;

        // 【修正】一対多の重複を防ぐため、ベースの山岳情報だけをシンプルに取得
        $sql = <<<EOS
            SELECT
                m.id,
                m.main_name AS name,
                m.main_kana AS kana,
                m.lat,
                m.lon,
                ROUND(m.elevation) AS elev,
                (
                    SELECT s.names_json->>'$[0].name'
                    FROM stg_gsi_gcp_pois AS s
                    JOIN poi_links AS p ON s.source_uuid = p.source_uuid
                    WHERE p.mountain_id = m.id
                    LIMIT 1
                ) AS gcp_name
            FROM mountain_pois AS m
            WHERE m.id = ?
            EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$mountain_id]);
        $results = $stmt->fetch();
        if (!$results) {
            http_response_code(404);
            echo json_encode(['error' => 'Not Found']);
            exit;
        }

        // 別途、情報源（ソースのオーソリティ）の display_name を取得してマージ
        $sql = <<<EOS
            SELECT 
                GROUP_CONCAT(
                    s.display_name 
                    ORDER BY s.reliability_level ASC, s.id ASC 
                    SEPARATOR ','
                ) AS auth_list
            FROM poi_names AS p
            JOIN (
                SELECT mountain_id, poi_name, poi_kana
                FROM poi_names
                WHERE is_preferred = 1
                AND mountain_id = ?
            ) AS pref
            ON p.mountain_id = pref.mountain_id
            AND p.poi_name = pref.poi_name
            AND p.poi_kana = pref.poi_kana
            JOIN information_sources AS s 
            ON p.source_id = s.id
            GROUP BY 
                p.mountain_id,
                p.poi_name,
                p.poi_kana;
        EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$mountain_id]);
        $auth_row = $stmt->fetch();
        $results['auth_list'] = $auth_row['auth_list'] ?? 'Unknown';

        # 親要素があればその名称を取得
        $sql = <<<EOS
            SELECT m.main_name AS name, m.main_kana AS kana
            FROM mountain_pois AS m
            JOIN poi_hierarchies AS h ON m.id = h.parent_id
            WHERE h.child_id = ?
        EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$mountain_id]);
        $results['parent'] = $stmt->fetchAll();

        # 別名を取得
        $sql = <<<EOS
            SELECT 
                p.poi_name AS name,
                p.poi_kana AS kana,
                GROUP_CONCAT(
                    s.display_name
                    ORDER BY s.reliability_level ASC,
                    s.id ASC SEPARATOR ','
                ) AS auth_list
            FROM mountain_pois AS m
            JOIN poi_names AS p ON m.id = p.mountain_id
            JOIN information_sources AS s ON p.source_id = s.id
            WHERE p.poi_kana IS NOT NULL AND p.poi_kana <> ''
                AND NOT (p.poi_name = m.main_name AND p.poi_kana = m.main_kana)
                AND m.id = ?
            GROUP BY p.poi_name, p.poi_kana;
            EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$mountain_id]);
        $results['aliases'] = $stmt->fetchAll();

        # 所在地を取得
        $sql = <<<EOS
            SELECT jis_code, full_name
            FROM poi_address_map
            JOIN administrative_regions USING (jis_code)
            WHERE mountain_id = ?
            ORDER BY jis_code
        EOS;
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$mountain_id]);
        $results['address'] = $stmt->fetchAll();

        header("Content-Type: application/json; charset=utf-8");
        header('Cache-Control: no-store, max-age=0');
        echo json_encode($results, JSON_UNESCAPED_UNICODE | JSON_NUMERIC_CHECK);
    }

// ----------------------------------------------------
// 逆ジオコーディング: /api/regions/reverse?lat=xxx&lon=yyy
// ----------------------------------------------------
} elseif ($resource === 'regions' && $action === 'reverse') {
    $coordinates = get_lat_lon();
    $lat = $coordinates['lat'];
    $lon = $coordinates['lon'];
    if (!($lat && $lon)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid latitude or longitude']);
        exit;
    }

    $stmt = $pdo->prepare("SET @point = ST_GeomFromText(?, 4326, 'axis-order=long-lat')");
    $stmt->execute(["POINT($lon $lat)"]);

    $sql = <<<EOS
        SELECT DISTINCT ar.jis_code, ar.full_name
        FROM administrative_regions AS ar
        LEFT JOIN administrative_boundaries AS ab ON ar.jis_code = ab.jis_code
        WHERE ST_Contains(ab.geom, @point)
        ORDER BY ar.jis_code
    EOS;
    $stmt = $pdo->query($sql);
    $results = $stmt->fetchAll();

    header("Content-Type: application/json; charset=utf-8");
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($results, JSON_UNESCAPED_UNICODE);

// ----------------------------------------------------
// 山行記録の個別情報: /api/records/{id}
// ----------------------------------------------------
} elseif ($resource === 'records' && is_numeric($action)) {
    $id = (int)$action;

    $sql = <<<EOS
        SELECT id, start_date, end_date, published_at, title, summary, public_url
        FROM mountain_records
        WHERE id = ?
    EOS;
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$id]);
    $results = $stmt->fetchAll();

    header("Content-Type: application/json; charset=utf-8");
    header('Cache-Control: no-store, max-age=0');
    echo json_encode($results, JSON_UNESCAPED_UNICODE);
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Invalid Resource']);
}

$pdo = null; // データベース接続の確実な切断
