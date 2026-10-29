<?php
/**
 * cPanel Postgres installer for Szoop.
 * 1. Upload this file AND prod_setup_cpanel.sql to the same folder.
 * 2. Fill the 4 values below.
 * 3. Open this file in the browser once.
 * 4. DELETE this PHP file when it says done.
 */
header('Content-Type: text/plain; charset=utf-8');

$host = 'localhost';
$port = '5432';
$name = 'YOUR_DB_NAME';
$user = 'YOUR_DB_USER';
$pass = 'YOUR_DB_PASSWORD';

$sqlFile = __DIR__ . '/prod_setup_cpanel.sql';
if (!is_readable($sqlFile)) {
    fwrite(STDERR, "Missing prod_setup_cpanel.sql next to this PHP file\n");
    http_response_code(500);
    echo "Missing prod_setup_cpanel.sql next to this PHP file\n";
    exit(1);
}

$connstr = sprintf(
    'host=%s port=%s dbname=%s user=%s password=%s',
    $host,
    $port,
    $name,
    $user,
    $pass
);

if (!function_exists('pg_connect')) {
    echo "PHP pgsql extension is not enabled. Ask the host to enable php-pgsql.\n";
    exit(1);
}

$conn = @pg_connect($connstr);
if (!$conn) {
    echo "Could not connect. Check host/db/user/password.\n";
    echo pg_last_error() ?: '';
    exit(1);
}

$sql = file_get_contents($sqlFile);
$statements = [];
$buf = '';
$inString = false;
$len = strlen($sql);
for ($i = 0; $i < $len; $i++) {
    $c = $sql[$i];
    if ($inString) {
        $buf .= $c;
        if ($c === "'" && ($i + 1 < $len) && $sql[$i + 1] === "'") {
            $buf .= $sql[$i + 1];
            $i++;
        } elseif ($c === "'") {
            $inString = false;
        }
        continue;
    }
    if ($c === "'") {
        $inString = true;
        $buf .= $c;
        continue;
    }
    if ($c === ';') {
        $stmt = trim($buf);
        $buf = '';
        $lines = [];
        foreach (preg_split("/\r\n|\n|\r/", $stmt) as $line) {
            $trim = ltrim($line);
            if ($trim === '' || strpos($trim, '--') === 0) {
                continue;
            }
            $lines[] = $line;
        }
        $stmt = trim(implode("\n", $lines));
        if ($stmt !== '') {
            $statements[] = $stmt;
        }
        continue;
    }
    $buf .= $c;
}

$ok = 0;
$skip = 0;
$fail = 0;
foreach ($statements as $index => $stmt) {
    $result = @pg_query($conn, $stmt);
    $n = $index + 1;
    if ($result) {
        $ok++;
        echo "OK  [$n]\n";
        continue;
    }
    $err = pg_last_error($conn);
    if (
        stripos($err, 'already exists') !== false
        || stripos($err, 'duplicate') !== false
    ) {
        $skip++;
        echo "SKIP[$n] $err\n";
        continue;
    }
    $fail++;
    echo "FAIL[$n] $err\n";
    echo substr($stmt, 0, 180) . "\n\n";
}

echo "\nDone. ok=$ok skip=$skip fail=$fail\n";
echo "Delete cpanel_install.php from the server now.\n";
pg_close($conn);
