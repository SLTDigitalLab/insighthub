@echo off
echo ========================================================
echo  Starting Local ChromaDB Vector Database on port 8000
echo ========================================================
python -m chromadb.cli.cli run --path ./chroma_db --port 8000
if %ERRORLEVEL% NEQ 0 (
    chroma run --path ./chroma_db --port 8000
)
pause
