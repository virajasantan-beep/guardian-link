from flask import Flask
from database import create_tables
from routes import routes_bp

app = Flask(__name__)
app.secret_key = "change-this-secret-key"
app.register_blueprint(routes_bp)
create_tables()

if __name__ == "__main__":
    app.run(debug=True)