package imitor

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// sqliteBackend is shared by all connections to one emulated database. It is
// deliberately kept behind the protocol handlers: both wire protocols expose
// the same SQLite data and therefore cannot drift apart.
type sqliteBackend struct {
	db *sql.DB
}

func newSQLiteBackend(path string) (*sqliteBackend, error) {
	if strings.TrimSpace(path) == "" {
		path = "honeypot.db"
	}
	if path != ":memory:" {
		path = filepath.Clean(path)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("configure sqlite database: %w", err)
	}
	return &sqliteBackend{db: db}, nil
}

func (b *sqliteBackend) query(sqlText string) ([]string, [][]any, error) {
	rows, err := b.db.Query(sqlText)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	result := make([][]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, nil, err
		}
		for i, value := range values {
			if bytes, ok := value.([]byte); ok {
				values[i] = string(bytes)
			}
		}
		result = append(result, values)
	}
	return columns, result, rows.Err()
}

func (b *sqliteBackend) exec(sqlText string) (int64, error) {
	result, err := b.db.Exec(sqlText)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return count, err
}
